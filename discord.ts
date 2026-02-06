const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

interface RequestData {
  id: string;
  type: string;
  userId: string;
  username?: string;
  data: string;
  createdAt: Date;
}

const REQUEST_TYPE_NAMES: Record<string, string> = {
  vehicle_transfer: "��� ����� �����",
  remove_reservation: "��� ����� ���",
  driving_license: "��� ���� �����",
  violation_certificate: "����� ���������",
};

export async function sendRequestNotification(request: RequestData, username: string): Promise<string | null> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
    console.error("Discord bot token or channel ID not configured");
    return null;
  }

  try {
    const parsedData = JSON.parse(request.data);
    const typeName = REQUEST_TYPE_NAMES[request.type] || request.type;
    
    const embed = {
      title: `��� ����: ${typeName}`,
      color: 0x2ecc71,
      fields: [
        { name: "��� �����", value: request.id, inline: true },
        { name: "���� �����", value: username, inline: true },
        { name: "��� �����", value: typeName, inline: true },
        { name: "������ �����", value: formatRequestData(parsedData), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "���� ����" },
    };

    const components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "���� �����",
            custom_id: `approve_${request.id}`,
            emoji: { name: "?" },
          },
          {
            type: 2,
            style: 4,
            label: "��� �����",
            custom_id: `reject_${request.id}`,
            emoji: { name: "?" },
          },
        ],
      },
    ];

    const response = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [embed],
        components,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to send Discord notification:", error);
      return null;
    }

    const message = await response.json();
    return message.id;
  } catch (error) {
    console.error("Error sending Discord notification:", error);
    return null;
  }
}

function formatRequestData(data: Record<string, unknown>): string {
  const lines: string[] = [];
  
  const fieldNames: Record<string, string> = {
    nationalId: "��� ������",
    vehicleNumber: "��� �������",
    newOwnerName: "��� ������ ������",
    reservationNumber: "��� �����",
    reason: "�����",
    dateOfBirth: "����� �������",
    licenseType: "��� ������",
    address: "�������",
    violationType: "��� ��������",
  };

  for (const [key, value] of Object.entries(data)) {
    if (key === "documents") continue;
    const label = fieldNames[key] || key;
    lines.push(`**${label}:** ${value}`);
  }

  return lines.join("") || "�� ���� ������";
}

export async function updateRequestMessage(messageId: string, status: "approved" | "rejected", reviewerName: string): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) return;

  try {
    const statusText = status === "approved" ? "? ��� ��������" : "? �� �����";
    const color = status === "approved" ? 0x2ecc71 : 0xe74c3c;

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [{
          title: statusText,
          description: `��� �������� ������: ${reviewerName}`,
          color,
          timestamp: new Date().toISOString(),
        }],
        components: [],
      }),
    });
  } catch (error) {
    console.error("Error updating Discord message:", error);
  }
}

export async function sendLoginNotification(username: string, method: "discord" | "password", avatar?: string | null): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ID) {
    return;
  }

  try {
    const methodText = method === "discord" ? "Discord OAuth" : "��� �������� ����� ������";
    const now = new Date();
    const timeStr = now.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
    const dateStr = now.toLocaleDateString("ar-SA");
    
    const embed = {
      title: "?? ����� ���� ����",
      color: 0x5865F2,
      thumbnail: avatar ? { url: avatar } : undefined,
      fields: [
        { name: "?? ��������", value: username, inline: true },
        { name: "?? ����� ������", value: methodText, inline: true },
        { name: "?? �����", value: timeStr, inline: true },
        { name: "?? �������", value: dateStr, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "���� ���� - ��� ������" },
    };

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });
  } catch (error) {
    console.error("Error sending login notification:", error);
  }
}

export async function handleInteraction(interaction: any): Promise<{ type: number; data?: any }> {
  if (interaction.type === 3) {
    const customId = interaction.data.custom_id;
    const [action, requestId] = customId.split("_");
    
    if (action === "approve" || action === "reject") {
      const { storage } = await import("./storage");
      const status = action === "approve" ? "approved" : "rejected";
      
      const discordUser = interaction.member?.user || interaction.user;
      const discordId = discordUser?.id;
      const discordUsername = discordUser?.username || "Unknown";
      
      let reviewer = discordId ? await storage.getUserByDiscordId(discordId) : null;
      
      if (!reviewer || (reviewer.role !== "admin" && reviewer.role !== "reviewer")) {
        return {
          type: 4,
          data: {
            content: "��� ���� ������ ������� �������",
            flags: 64,
          },
        };
      }

      const request = await storage.getRequest(requestId);
      if (!request) {
        return {
          type: 4,
          data: {
            content: "����� ��� �����",
            flags: 64,
          },
        };
      }

      if (request.status !== "pending") {
        return {
          type: 4,
          data: {
            content: `��� ����� ��� ������� ������: ${request.status === "approved" ? "�����" : "�����"}`,
            flags: 64,
          },
        };
      }

      await storage.updateRequest(requestId, {
        status,
        reviewedBy: reviewer.id,
        reviewNote: `��� �������� ��� Discord ������ ${discordUsername}`,
      });
      await storage.createRequestHistory({
        requestId,
        userId: reviewer.id,
        action: `request_${status}`,
        previousStatus: request.status,
        newStatus: status,
        details: `Request ${status} via Discord by ${discordUsername}`,
      });

      await storage.createAuditLog({
        userId: reviewer.id,
        action: `request_${status}`,
        targetId: requestId,
        details: `Request ${status} via Discord by ${discordUsername}`,
      });
      if (status === "approved" && (request.type === "id_card_request" || request.type === "driving_license")) {
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
            discordUsername ||
            "??????";
          const idNumber =
            parsedData.currentIdNumber ||
            parsedData.nationalId ||
            "??? ?????";
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

      const statusText = status === "approved" ? "��� �������� ���" : "�� ���";
      
      return {
        type: 7,
        data: {
          embeds: [{
            title: status === "approved" ? "? ��� ��������" : "? �� �����",
            description: `${statusText} ����� ������ ${discordUsername}`,
            color: status === "approved" ? 0x2ecc71 : 0xe74c3c,
            timestamp: new Date().toISOString(),
          }],
          components: [],
        },
      };
    }
  }

  return { type: 1 };
}






