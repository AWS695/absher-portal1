import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertRequestSchema } from "@shared/schema";
import { z } from "zod";
import { requireAuth, requireAdmin, requireReviewer } from "./middleware/auth";
import { sendRequestNotification, handleInteraction, sendLoginNotification } from "./discord";
import nacl from "tweetnacl";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

const createRequestSchema = z.object({
  type: z.enum([
    "vehicle_registration",
    "remove_vehicle_hold",
    "vehicle_transfer",
    "pay_violations",
    "id_card_request",
    "driving_license",
    "remove_service_suspension",
  ]),
  data: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]).optional().default("pending"),
});

const updateRequestSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]),
  reviewNote: z.string().optional(),
  reviewedBy: z.string().optional(),
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "reviewer", "user"]),
});

const ADMIN_USERNAMES = [
  "uv.x",
  "omarbinmayed",
  "bve6",
  "qt7_.o",
  "b_m3",
  "9ay7",
  "ar_454",
];

const SLA_HOURS_BY_TYPE: Record<string, number> = {
  vehicle_registration: 48,
  remove_vehicle_hold: 24,
  vehicle_transfer: 72,
  pay_violations: 6,
  id_card_request: 96,
  driving_license: 120,
  remove_service_suspension: 48,
};

const uploadsRoot = path.resolve(process.cwd(), "uploads");
const tempUploadsRoot = path.join(uploadsRoot, "tmp");
if (!fs.existsSync(tempUploadsRoot)) {
  fs.mkdirSync(tempUploadsRoot, { recursive: true });
}

const upload = multer({
  dest: tempUploadsRoot,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported file type"));
  },
});

const sanitizeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

// Discord OAuth configuration
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const defaultHost = process.env.HOST && process.env.HOST !== "0.0.0.0"
  ? process.env.HOST
  : "localhost";
const defaultPort = process.env.PORT || "5000";
const localRedirect = `http://${defaultHost}:${defaultPort}/api/auth/discord/callback`;
const DISCORD_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/discord/callback`
    : process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/auth/discord/callback`
      : localRedirect);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Discord OAuth - Start
  app.get("/api/auth/discord", (req, res) => {
    if (!DISCORD_CLIENT_ID) {
      return res.status(500).json({ error: "Discord OAuth not configured" });
    }
    
    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(2, 15);
    req.session.oauthState = state;
    
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: DISCORD_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state: state,
    });
    
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });

  // Discord OAuth - Callback
  app.get("/api/auth/discord/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      
      // Verify state for CSRF protection
      if (state !== req.session.oauthState) {
        return res.redirect("/login?error=invalid_state");
      }
      delete req.session.oauthState;
      
      if (!code || typeof code !== "string") {
        return res.redirect("/login?error=no_code");
      }
      
      if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.redirect("/login?error=oauth_not_configured");
      }
      
      // Exchange code for token
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: DISCORD_CLIENT_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: "authorization_code",
          code: code,
          redirect_uri: DISCORD_REDIRECT_URI,
        }),
      });
      
      if (!tokenResponse.ok) {
        console.error("Discord token exchange failed");
        return res.redirect("/login?error=token_exchange_failed");
      }
      
      const tokenData = await tokenResponse.json();
      
      // Get user info from Discord
      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });
      
      if (!userResponse.ok) {
        console.error("Discord user info failed:", await userResponse.text());
        return res.redirect("/login?error=user_info_failed");
      }
      
      const discordUser = await userResponse.json();
      const discordId = discordUser.id;
      const username = discordUser.username;
      const avatar = discordUser.avatar 
        ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
        : null;
      
      // Check if user exists by discordId
      let user = await storage.getUserByDiscordId(discordId);
      
      if (!user) {
        // Check if user exists by username (for backward compatibility)
        user = await storage.getUserByUsername(username);
        
        if (user) {
          // Update existing user with Discord ID
          await storage.updateUser(user.id, { 
            discordId, 
            avatar: avatar,
            accountStatus: "active" 
          });
        } else {
          // Create new user
          const isAdmin = ADMIN_USERNAMES.includes(username.toLowerCase()) || 
                          ADMIN_USERNAMES.includes(username);
          
          user = await storage.createUser({
            username,
            discordId,
            avatar: avatar,
            role: isAdmin ? "admin" : "user",
            accountStatus: "active",
          });
          
          await storage.createAuditLog({
            userId: user.id,
            action: "user_created",
            details: `تم إنشاء حساب جديد عبر Discord: ${username}`,
          });
        }
      } else {
        // Update avatar if changed
        if (avatar !== user.avatar) {
          await storage.updateUser(user.id, { avatar: avatar });
        }
      }
      
      // Create session
      req.session.userId = user.id;
      
      await storage.createAuditLog({
        userId: user.id,
        action: "user_login",
        details: `تسجيل دخول عبر Discord: ${username}`,
      });
      
      // Send Discord notification for login
      sendLoginNotification(username, "discord", avatar);
      
      res.redirect("/");
    } catch (error) {
      console.error("Discord OAuth error:", error);
      res.redirect("/login?error=oauth_failed");
    }
  });

  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = registerSchema.parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(data.username);
      if (existingUser) {
        return res.status(400).json({ error: "اسم المستخدم موجود مسبقاً" });
      }
      
      // Generate activation token
      const activationToken = generateActivationToken();
      const passwordHash = await bcrypt.hash(data.password, 10);
      
      // Check if admin
      const isAdmin = ADMIN_USERNAMES.includes(data.username.toLowerCase()) || 
                      ADMIN_USERNAMES.includes(data.username);
      
      // Create user with pending status
      const user = await storage.createUser({
        username: data.username,
        passwordHash,
        role: isAdmin ? "admin" : "user",
        accountStatus: "pending",
        activationToken,
        activationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });
      
      await storage.createAuditLog({
        userId: user.id,
        action: "user_created",
        details: `تم إنشاء حساب جديد: ${data.username}`,
      });
      
      res.json({ 
        success: true, 
        message: "تم إنشاء الحساب بنجاح. يرجى تفعيل حسابك",
        activationToken, // Return token for user to see
        username: data.username
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Registration error:", error);
      res.status(500).json({ error: "حدث خطأ أثناء التسجيل" });
    }
  });

  // Activate account
  app.post("/api/auth/activate", async (req, res) => {
    try {
      const data = activateSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(data.username);
      if (!user) {
        return res.status(400).json({ error: "المستخدم غير موجود" });
      }
      
      if (user.accountStatus === "active") {
        return res.status(400).json({ error: "الحساب مفعل مسبقاً" });
      }
      
      if (user.activationToken !== data.activationToken) {
        return res.status(400).json({ error: "رمز التفعيل غير صحيح" });
      }
      
      if (user.activationTokenExpiresAt && new Date() > user.activationTokenExpiresAt) {
        return res.status(400).json({ error: "رمز التفعيل منتهي الصلاحية" });
      }
      
      // Verify password
      if (!user.passwordHash) {
        return res.status(400).json({ error: "خطأ في البيانات" });
      }
      
      const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "كلمة المرور غير صحيحة" });
      }
      
      // Activate the account
      await storage.updateUser(user.id, {
        accountStatus: "active",
        activationToken: null,
        activationTokenExpiresAt: null,
      });
      
      await storage.createAuditLog({
        userId: user.id,
        action: "account_activated",
        details: `تم تفعيل الحساب: ${user.username}`,
      });
      
      // Auto login after activation
      req.session.userId = user.id;
      
      res.json({ success: true, message: "تم تفعيل الحساب بنجاح" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Activation error:", error);
      res.status(500).json({ error: "حدث خطأ أثناء التفعيل" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(data.username);
      if (!user) {
        return res.status(400).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }
      
      if (!user.passwordHash) {
        return res.status(400).json({ error: "هذا الحساب يتطلب تسجيل الدخول عبر طريقة أخرى" });
      }
      
      const isPasswordValid = await bcrypt.compare(data.password, user.passwordHash);
      if (!isPasswordValid) {
        return res.status(400).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" });
      }
      
      if (user.accountStatus === "pending") {
        return res.status(400).json({ 
          error: "الحساب غير مفعل",
          needsActivation: true,
          username: user.username
        });
      }
      
      if (user.accountStatus === "disabled") {
        return res.status(400).json({ error: "هذا الحساب معطل" });
      }
      
      req.session.userId = user.id;
      
      await storage.createAuditLog({
        userId: user.id,
        action: "user_login",
        details: `تسجيل دخول: ${user.username}`,
      });
      
      // Send Discord notification for login
      sendLoginNotification(user.username, "password", user.avatar);
      
      res.json({ user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0].message });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "حدث خطأ أثناء تسجيل الدخول" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    
    const user = await storage.getUser(req.session.userId);
    res.json({ user: user || null });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.post("/api/discord/interactions", async (req, res) => {
    try {
      const signature = req.headers["x-signature-ed25519"] as string;
      const timestamp = req.headers["x-signature-timestamp"] as string;
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      
      if (!publicKey) {
        console.error("Discord public key not configured");
        return res.status(500).json({ error: "Discord not configured" });
      }

      if (!signature || !timestamp) {
        return res.status(401).json({ error: "Missing signature" });
      }

      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        return res.status(400).json({ error: "Missing body" });
      }

      const message = Buffer.concat([Buffer.from(timestamp), rawBody]);
      const isValid = nacl.sign.detached.verify(
        message,
        Buffer.from(signature, "hex"),
        Buffer.from(publicKey, "hex")
      );

      if (!isValid) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      if (req.body.type === 1) {
        return res.json({ type: 1 });
      }

      const result = await handleInteraction(req.body);
      res.json(result);
    } catch (error) {
      console.error("Discord interaction error:", error);
      res.status(500).json({ type: 4, data: { content: "حدث خطأ", flags: 64 } });
    }
  });

  app.get("/api/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = updateRoleSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid role", details: parsed.error.errors });
      }

      const user = await storage.updateUserRole(id, parsed.data.role);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "role_updated",
        targetId: id,
        details: `Role changed to: ${parsed.data.role}`,
      });

      res.json(user);
    } catch (error) {
      console.error("Update role error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests", requireAuth, async (req, res) => {
    try {
      const user = req.user!;
      if (user.role === "admin" || user.role === "reviewer") {
        const requests = await storage.getAllRequests();
        res.json(requests);
      } else {
        const requests = await storage.getRequestsByUserId(user.id);
        res.json(requests);
      }
    } catch (error) {
      console.error("Get requests error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests/me", requireAuth, async (req, res) => {
    try {
      const requests = await storage.getRequestsByUserId(req.user!.id);
      res.json(requests);
    } catch (error) {
      console.error("Get user requests error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getRequestStats();
      res.json(stats);
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await storage.getRequest(id);
      
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(request);
    } catch (error) {
      console.error("Get request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests/:id/insights", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await storage.getRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      const createdAt = request.createdAt ? new Date(request.createdAt) : new Date();
      const slaHours = SLA_HOURS_BY_TYPE[request.type] ?? 48;
      const totalMs = slaHours * 60 * 60 * 1000;
      const elapsedMs = Date.now() - createdAt.getTime();
      const rawProgress = Math.round((elapsedMs / totalMs) * 100);
      const progress =
        request.status === "pending"
          ? Math.min(95, Math.max(5, rawProgress))
          : 100;
      const eta =
        request.status === "pending"
          ? new Date(createdAt.getTime() + totalMs)
          : null;

      let stage = "استلام الطلب";
      if (request.status === "approved") {
        stage = "مكتمل";
      } else if (request.status === "rejected") {
        stage = "مرفوض";
      } else if (progress >= 70) {
        stage = "التحقق النهائي";
      } else if (progress >= 35) {
        stage = "قيد المراجعة";
      }

      const history = await storage.getRequestHistory(request.id);
      const lastUpdateAt = history[0]?.createdAt || request.updatedAt || request.createdAt;

      res.json({
        stage,
        progress,
        eta,
        slaHours,
        lastUpdateAt,
      });
    } catch (error) {
      console.error("Get request insights error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/requests/:id/attachments", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const request = await storage.getRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      const attachments = await storage.getRequestAttachments(id);
      res.json(attachments);
    } catch (error) {
      console.error("Get attachments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/requests/:id/attachments", requireAuth, upload.array("files", 5), async (req, res) => {
    try {
      const { id } = req.params;
      const request = await storage.getRequest(id);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      const files = (req.files || []) as Express.Multer.File[];
      if (files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const documentType = sanitizeSegment((req.body.documentType || "general").toString());
      const requestFolder = path.join(uploadsRoot, "requests", request.id, documentType);
      if (!fs.existsSync(requestFolder)) {
        fs.mkdirSync(requestFolder, { recursive: true });
      }

      let nextVersion = await storage.getNextAttachmentVersion(request.id, documentType);
      const createdAttachments = [];

      for (const file of files) {
        const originalBase = sanitizeSegment(path.parse(file.originalname).name);
        const ext = path.extname(file.originalname) || "";
        const fileName = `${documentType}_v${nextVersion}_${Date.now()}_${originalBase}${ext}`;
        const finalPath = path.join(requestFolder, fileName);

        fs.renameSync(file.path, finalPath);
        const buffer = fs.readFileSync(finalPath);
        const signature = crypto
          .createHmac("sha256", process.env.SESSION_SECRET || "absher")
          .update(buffer)
          .digest("hex");

        const attachment = await storage.createRequestAttachment({
          requestId: request.id,
          userId: user.id,
          documentType,
          originalName: file.originalname,
          fileName,
          mimeType: file.mimetype,
          size: file.size,
          version: nextVersion,
          signature,
          storagePath: finalPath,
        });
        createdAttachments.push(attachment);
        nextVersion += 1;
      }

      res.status(201).json(createdAttachments);
    } catch (error) {
      console.error("Upload attachments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/attachments/:id", requireAuth, async (req, res) => {
    try {
      const attachment = await storage.getRequestAttachment(req.params.id);
      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const request = await storage.getRequest(attachment.requestId);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!fs.existsSync(attachment.storagePath)) {
        return res.status(404).json({ error: "File missing" });
      }

      res.download(attachment.storagePath, attachment.originalName);
    } catch (error) {
      console.error("Download attachment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/attachments/:id/preview", requireAuth, async (req, res) => {
    try {
      const attachment = await storage.getRequestAttachment(req.params.id);
      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const request = await storage.getRequest(attachment.requestId);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!fs.existsSync(attachment.storagePath)) {
        return res.status(404).json({ error: "File missing" });
      }

      res.setHeader("Content-Type", attachment.mimeType);
      res.sendFile(attachment.storagePath);
    } catch (error) {
      console.error("Preview attachment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/requests", requireAuth, async (req, res) => {
    try {
      const parsed = createRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
      }

      const request = await storage.createRequest({
        ...parsed.data,
        userId: req.user!.id,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "request_created",
        targetId: request.id,
        details: `New ${parsed.data.type} request submitted`,
      });

      await storage.createRequestHistory({
        requestId: request.id,
        userId: req.user!.id,
        action: "request_created",
        previousStatus: null,
        newStatus: request.status,
        details: "تم إنشاء الطلب",
      });

      // Discord notification disabled
      // sendRequestNotification({
      //   id: request.id,
      //   type: request.type,
      //   userId: request.userId,
      //   data: request.data,
      //   createdAt: request.createdAt || new Date(),
      // }, req.user!.username).catch((err: Error) => {
      //   console.error("Failed to send Discord notification:", err);
      // });

      res.status(201).json(request);
    } catch (error) {
      console.error("Create request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/requests/:id", requireAuth, requireReviewer, async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = updateRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid update data", details: parsed.error.errors });
      }

      const existingRequest = await storage.getRequest(id);
      if (!existingRequest) {
        return res.status(404).json({ error: "Request not found" });
      }

      const request = await storage.updateRequest(id, {
        status: parsed.data.status,
        reviewNote: parsed.data.reviewNote,
        reviewedBy: req.user!.id,
      });

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (existingRequest.status !== parsed.data.status) {
        await storage.createRequestHistory({
          requestId: request.id,
          userId: req.user!.id,
          action: `request_${parsed.data.status}`,
          previousStatus: existingRequest.status,
          newStatus: parsed.data.status,
          details: parsed.data.reviewNote || `Request ${parsed.data.status}`,
        });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: `request_${parsed.data.status}`,
        targetId: id,
        details: parsed.data.reviewNote || `Request ${parsed.data.status}`,
      });

      if (
        parsed.data.status === "approved" &&
        existingRequest.status !== "approved" &&
        (request.type === "id_card_request" || request.type === "driving_license")
      ) {
        const existingCard = await storage.getDigitalIdCardByUserAndType(request.userId, request.type);
        if (!existingCard) {
          let parsedData: Record<string, string> = {};
          try {
            parsedData = JSON.parse(request.data || "{}");
          } catch {
            parsedData = {};
          }

          const attachments = await storage.getRequestAttachments(request.id);
          const photoAttachment = attachments.find((item) => item.documentType === "id_photo");

          const fullName =
            parsedData.fullName ||
            parsedData.applicantName ||
            req.user?.username ||
            "مستخدم";
          const idNumber =
            parsedData.currentIdNumber ||
            parsedData.nationalId ||
            "غير متوفر";
          const issueDate = new Date();
          const expiresAt = new Date(issueDate);
          expiresAt.setFullYear(expiresAt.getFullYear() + (request.type === "driving_license" ? 10 : 5));

          await storage.createDigitalIdCard({
            userId: request.userId,
            type: request.type,
            fullName,
            idNumber,
            photoAttachmentId: photoAttachment?.id,
            issueDate,
            expiresAt,
            status: "active",
          });
        }
      }

      res.json(request);
    } catch (error) {
      console.error("Update request error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const requestStats = await storage.getRequestStats();
      const usersCount = await storage.getUsersCount();
      
      res.json({
        ...requestStats,
        usersCount,
      });
    } catch (error) {
      console.error("Get admin stats error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/audit-logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Appointment routes
  app.get("/api/appointments", requireAuth, async (req, res) => {
    try {
      const appointments = await storage.getAppointmentsByUserId(req.user!.id);
      res.json(appointments);
    } catch (error) {
      console.error("Get appointments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/appointments/available/:date", requireAuth, async (req, res) => {
    try {
      const date = new Date(req.params.date);
      const booked = await storage.getAppointmentsByDate(date);
      const bookedSlots = booked
        .filter(a => a.status !== "cancelled")
        .map(a => a.timeSlot);
      
      const allSlots = [
        "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
        "12:00", "12:30", "14:00", "14:30", "15:00", "15:30", "16:00"
      ];
      
      const availableSlots = allSlots.filter(slot => !bookedSlots.includes(slot));
      res.json({ availableSlots, bookedSlots });
    } catch (error) {
      console.error("Get available slots error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/appointments", requireAuth, async (req, res) => {
    try {
      const { serviceType, date, timeSlot, notes } = req.body;
      
      if (!serviceType || !date || !timeSlot) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const appointment = await storage.createAppointment({
        userId: req.user!.id,
        serviceType,
        date: new Date(date),
        timeSlot,
        status: "scheduled",
        notes: notes || null,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "appointment_created",
        targetId: appointment.id,
        details: `Appointment booked for ${serviceType} on ${date} at ${timeSlot}`,
      });

      res.status(201).json(appointment);
    } catch (error) {
      console.error("Create appointment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.patch("/api/appointments/:id/cancel", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const appointment = await storage.cancelAppointment(id);
      
      if (!appointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "appointment_cancelled",
        targetId: id,
        details: "Appointment cancelled",
      });

      res.json(appointment);
    } catch (error) {
      console.error("Cancel appointment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Request Comments routes - Only reviewers/admins can view internal comments
  app.get("/api/requests/:id/comments", requireAuth, requireReviewer, async (req, res) => {
    try {
      const request = await storage.getRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }
      
      const comments = await storage.getRequestComments(req.params.id);
      res.json(comments);
    } catch (error) {
      console.error("Get comments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/requests/:id/comments", requireAuth, requireReviewer, async (req, res) => {
    try {
      const { content, isInternal } = req.body;
      
      if (!content) {
        return res.status(400).json({ error: "Content is required" });
      }

      const comment = await storage.createRequestComment({
        requestId: req.params.id,
        userId: req.user!.id,
        content,
        isInternal: isInternal ? "true" : "false",
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "comment_added",
        targetId: req.params.id,
        details: `Comment added to request`,
      });

      res.status(201).json(comment);
    } catch (error) {
      console.error("Create comment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Request History routes - Only reviewers/admins can view internal history
  app.get("/api/requests/:id/history", requireAuth, async (req, res) => {
    try {
      const request = await storage.getRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      const user = req.user!;
      if (request.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      const history = await storage.getRequestHistory(req.params.id);
      res.json(history);
    } catch (error) {
      console.error("Get request history error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Digital wallet
  app.get("/api/wallet/cards", requireAuth, async (req, res) => {
    try {
      const cards = await storage.getDigitalIdCardsByUserId(req.user!.id);
      res.json(cards);
    } catch (error) {
      console.error("Get wallet cards error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/wallet/cards/:id/share", requireAuth, async (req, res) => {
    try {
      const card = await storage.getDigitalIdCardById(req.params.id);
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }

      const user = req.user!;
      if (card.userId !== user.id && user.role !== "admin" && user.role !== "reviewer") {
        return res.status(403).json({ error: "Access denied" });
      }

      const token = crypto.randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const shareToken = await storage.createWalletShareToken({
        cardId: card.id,
        token,
        expiresAt,
      });

      res.json({
        token: shareToken.token,
        expiresAt: shareToken.expiresAt,
        shareUrl: `/wallet/share/${shareToken.token}`,
      });
    } catch (error) {
      console.error("Create share token error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/wallet/share/:token", async (req, res) => {
    try {
      const tokenRow = await storage.getWalletShareToken(req.params.token);
      if (!tokenRow) {
        return res.status(404).json({ error: "Token not found" });
      }

      if (new Date() > new Date(tokenRow.expiresAt)) {
        return res.status(410).json({ error: "Token expired" });
      }

      const card = await storage.getDigitalIdCardById(tokenRow.cardId);
      if (!card) {
        return res.status(404).json({ error: "Card not found" });
      }

      const maskedId = card.idNumber.length > 4
        ? `${"*".repeat(Math.max(0, card.idNumber.length - 4))}${card.idNumber.slice(-4)}`
        : card.idNumber;

      res.json({
        id: card.id,
        type: card.type,
        fullName: card.fullName,
        idNumber: maskedId,
        issueDate: card.issueDate,
        expiresAt: card.expiresAt,
        status: card.status,
      });
    } catch (error) {
      console.error("Get shared wallet card error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Filtered Audit Logs
  app.get("/api/audit-logs/filter", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { action, userId, startDate, endDate } = req.query;
      const logs = await storage.getAuditLogsFiltered({
        action: action as string | undefined,
        userId: userId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      res.json(logs);
    } catch (error) {
      console.error("Get filtered audit logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Pending Requests Alerts (requests older than X hours)
  app.get("/api/admin/pending-alerts", requireAuth, requireAdmin, async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const pendingRequests = await storage.getPendingRequestsOlderThan(hours);
      res.json(pendingRequests);
    } catch (error) {
      console.error("Get pending alerts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return httpServer;
}
