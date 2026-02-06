import { 
  users, 
  requests, 
  auditLogs,
  appointments,
  requestComments,
  requestHistory,
  requestAttachments,
  digitalIdCards,
  walletShareTokens,
  type User, 
  type InsertUser,
  type Request,
  type InsertRequest,
  type AuditLog,
  type InsertAuditLog,
  type Appointment,
  type InsertAppointment,
  type RequestComment,
  type InsertRequestComment,
  type RequestHistory,
  type InsertRequestHistory,
  type RequestAttachment,
  type InsertRequestAttachment,
  type DigitalIdCard,
  type InsertDigitalIdCard,
  type WalletShareToken,
  type InsertWalletShareToken
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, count, like, or, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByDiscordId(discordId: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersCount(): Promise<number>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  
  createRequest(request: InsertRequest): Promise<Request>;
  getRequest(id: string): Promise<Request | undefined>;
  getAllRequests(): Promise<Request[]>;
  getRequestsByUserId(userId: string): Promise<Request[]>;
  updateRequest(id: string, data: Partial<Request>): Promise<Request | undefined>;
  getRequestStats(): Promise<{ total: number; pending: number; approved: number; rejected: number }>;
  
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(): Promise<AuditLog[]>;
  
  createAppointment(appointment: InsertAppointment): Promise<Appointment>;
  getAppointmentsByUserId(userId: string): Promise<Appointment[]>;
  getAppointmentsByDate(date: Date): Promise<Appointment[]>;
  updateAppointment(id: string, data: Partial<Appointment>): Promise<Appointment | undefined>;
  cancelAppointment(id: string): Promise<Appointment | undefined>;
  
  createRequestComment(comment: InsertRequestComment): Promise<RequestComment>;
  getRequestComments(requestId: string): Promise<RequestComment[]>;
  
  createRequestHistory(history: InsertRequestHistory): Promise<RequestHistory>;
  getRequestHistory(requestId: string): Promise<RequestHistory[]>;
  
  createRequestAttachment(attachment: InsertRequestAttachment): Promise<RequestAttachment>;
  getRequestAttachments(requestId: string): Promise<RequestAttachment[]>;
  getRequestAttachment(id: string): Promise<RequestAttachment | undefined>;
  getNextAttachmentVersion(requestId: string, documentType: string): Promise<number>;

  createDigitalIdCard(card: InsertDigitalIdCard): Promise<DigitalIdCard>;
  getDigitalIdCardsByUserId(userId: string): Promise<DigitalIdCard[]>;
  getDigitalIdCardById(id: string): Promise<DigitalIdCard | undefined>;
  getDigitalIdCardByUserAndType(userId: string, type: string): Promise<DigitalIdCard | undefined>;

  createWalletShareToken(token: InsertWalletShareToken): Promise<WalletShareToken>;
  getWalletShareToken(token: string): Promise<WalletShareToken | undefined>;
  
  getAuditLogsFiltered(filters: { action?: string; userId?: string; startDate?: Date; endDate?: Date }): Promise<AuditLog[]>;
  getPendingRequestsOlderThan(hours: number): Promise<Request[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByDiscordId(discordId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.discordId, discordId));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUsersCount(): Promise<number> {
    const [result] = await db.select({ count: count() }).from(users);
    return result?.count ?? 0;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async createRequest(insertRequest: InsertRequest): Promise<Request> {
    const [request] = await db.insert(requests).values(insertRequest).returning();
    return request;
  }

  async getRequest(id: string): Promise<Request | undefined> {
    const [request] = await db.select().from(requests).where(eq(requests.id, id));
    return request || undefined;
  }

  async getAllRequests(): Promise<Request[]> {
    return await db.select().from(requests).orderBy(desc(requests.createdAt));
  }

  async getRequestsByUserId(userId: string): Promise<Request[]> {
    return await db
      .select()
      .from(requests)
      .where(eq(requests.userId, userId))
      .orderBy(desc(requests.createdAt));
  }

  async updateRequest(id: string, data: Partial<Request>): Promise<Request | undefined> {
    const [request] = await db
      .update(requests)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(requests.id, id))
      .returning();
    return request || undefined;
  }

  async getRequestStats(): Promise<{ total: number; pending: number; approved: number; rejected: number }> {
    const [totalResult] = await db.select({ count: count() }).from(requests);
    const [pendingResult] = await db.select({ count: count() }).from(requests).where(eq(requests.status, "pending"));
    const [approvedResult] = await db.select({ count: count() }).from(requests).where(eq(requests.status, "approved"));
    const [rejectedResult] = await db.select({ count: count() }).from(requests).where(eq(requests.status, "rejected"));
    
    return {
      total: totalResult?.count ?? 0,
      pending: pendingResult?.count ?? 0,
      approved: approvedResult?.count ?? 0,
      rejected: rejectedResult?.count ?? 0,
    };
  }

  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    return log;
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
  }

  async createAppointment(insertAppointment: InsertAppointment): Promise<Appointment> {
    const [appointment] = await db.insert(appointments).values(insertAppointment).returning();
    return appointment;
  }

  async getAppointmentsByUserId(userId: string): Promise<Appointment[]> {
    return await db
      .select()
      .from(appointments)
      .where(eq(appointments.userId, userId))
      .orderBy(desc(appointments.date));
  }

  async getAppointmentsByDate(date: Date): Promise<Appointment[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    return await db
      .select()
      .from(appointments)
      .where(
        and(
          gte(appointments.date, startOfDay),
          lte(appointments.date, endOfDay)
        )
      );
  }

  async updateAppointment(id: string, data: Partial<Appointment>): Promise<Appointment | undefined> {
    const [appointment] = await db
      .update(appointments)
      .set(data)
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async cancelAppointment(id: string): Promise<Appointment | undefined> {
    const [appointment] = await db
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.id, id))
      .returning();
    return appointment || undefined;
  }

  async createRequestComment(insertComment: InsertRequestComment): Promise<RequestComment> {
    const [comment] = await db.insert(requestComments).values(insertComment).returning();
    return comment;
  }

  async getRequestComments(requestId: string): Promise<RequestComment[]> {
    return await db
      .select()
      .from(requestComments)
      .where(eq(requestComments.requestId, requestId))
      .orderBy(desc(requestComments.createdAt));
  }

  async createRequestHistory(insertHistory: InsertRequestHistory): Promise<RequestHistory> {
    const [history] = await db.insert(requestHistory).values(insertHistory).returning();
    return history;
  }

  async getRequestHistory(requestId: string): Promise<RequestHistory[]> {
    return await db
      .select()
      .from(requestHistory)
      .where(eq(requestHistory.requestId, requestId))
      .orderBy(desc(requestHistory.createdAt));
  }

  async createRequestAttachment(insertAttachment: InsertRequestAttachment): Promise<RequestAttachment> {
    const [attachment] = await db.insert(requestAttachments).values(insertAttachment).returning();
    return attachment;
  }

  async getRequestAttachments(requestId: string): Promise<RequestAttachment[]> {
    return await db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, requestId))
      .orderBy(desc(requestAttachments.createdAt));
  }

  async getRequestAttachment(id: string): Promise<RequestAttachment | undefined> {
    const [attachment] = await db.select().from(requestAttachments).where(eq(requestAttachments.id, id));
    return attachment || undefined;
  }

  async getNextAttachmentVersion(requestId: string, documentType: string): Promise<number> {
    const [result] = await db
      .select({ maxVersion: sql<number>`max(${requestAttachments.version})` })
      .from(requestAttachments)
      .where(and(eq(requestAttachments.requestId, requestId), eq(requestAttachments.documentType, documentType)));
    return (result?.maxVersion ?? 0) + 1;
  }

  async createDigitalIdCard(insertCard: InsertDigitalIdCard): Promise<DigitalIdCard> {
    const [card] = await db.insert(digitalIdCards).values(insertCard).returning();
    return card;
  }

  async getDigitalIdCardsByUserId(userId: string): Promise<DigitalIdCard[]> {
    return await db
      .select()
      .from(digitalIdCards)
      .where(eq(digitalIdCards.userId, userId))
      .orderBy(desc(digitalIdCards.createdAt));
  }

  async getDigitalIdCardById(id: string): Promise<DigitalIdCard | undefined> {
    const [card] = await db.select().from(digitalIdCards).where(eq(digitalIdCards.id, id));
    return card || undefined;
  }

  async getDigitalIdCardByUserAndType(userId: string, type: string): Promise<DigitalIdCard | undefined> {
    const [card] = await db
      .select()
      .from(digitalIdCards)
      .where(and(eq(digitalIdCards.userId, userId), eq(digitalIdCards.type, type)));
    return card || undefined;
  }

  async createWalletShareToken(insertToken: InsertWalletShareToken): Promise<WalletShareToken> {
    const [token] = await db.insert(walletShareTokens).values(insertToken).returning();
    return token;
  }

  async getWalletShareToken(token: string): Promise<WalletShareToken | undefined> {
    const [tokenRow] = await db.select().from(walletShareTokens).where(eq(walletShareTokens.token, token));
    return tokenRow || undefined;
  }

  async getAuditLogsFiltered(filters: { action?: string; userId?: string; startDate?: Date; endDate?: Date }): Promise<AuditLog[]> {
    let query = db.select().from(auditLogs);
    const conditions = [];
    
    if (filters.action) {
      conditions.push(like(auditLogs.action, `%${filters.action}%`));
    }
    if (filters.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }
    if (filters.startDate) {
      conditions.push(gte(auditLogs.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(auditLogs.createdAt, filters.endDate));
    }
    
    if (conditions.length > 0) {
      return await db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt));
    }
    
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
  }

  async getPendingRequestsOlderThan(hours: number): Promise<Request[]> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);
    
    return await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.status, "pending"),
          lte(requests.createdAt, cutoffDate)
        )
      )
      .orderBy(requests.createdAt);
  }
}

export const storage = new DatabaseStorage();
