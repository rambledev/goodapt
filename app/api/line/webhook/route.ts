import { NextResponse } from "next/server";
import * as LineSDK from "@line/bot-sdk";
import Tesseract from "tesseract.js";

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}


export function GET() {
  // สำหรับ LINE Webhook Verify (ต้องตอบ 200 เท่านั้น)
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    // ป้องกัน JSON error ตอน LINE verify
    const body = await safeJson(req);

    // ถ้าไม่มี events → คือ LINE verify → ส่ง 200 ทันที
    if (!body.events) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const channelToken = process.env.LINE_CHANNEL_TOKEN;
    if (!channelToken) {
      console.error("LINE_CHANNEL_TOKEN is missing");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const config = {
      channelAccessToken: channelToken,
      channelSecret: process.env.LINE_CHANNEL_SECRET || "",
    };
    
    const client = new LineSDK.Client(config);

    for (const event of body.events) {
      if (event.type === "message" && event.message.type === "image") {
        const messageId = event.message.id;

        try {
          const stream = await client.getMessageContent(messageId);
          
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);

          const result = await Tesseract.recognize(buffer, "eng");
          const extracted = result.data.text.trim();

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `ค่ามิเตอร์ที่อ่านได้คือ: ${extracted || "ไม่สามารถอ่านค่าได้"}`,
          });

        } catch (error) {
          console.error("Error processing image:", error);

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "ขออภัย ไม่สามารถประมวลผลภาพได้ในขณะนี้",
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


export const dynamic = "force-dynamic";