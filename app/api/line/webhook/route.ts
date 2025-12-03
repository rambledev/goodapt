import { NextResponse } from "next/server";
import * as LineSDK from "@line/bot-sdk";
import Tesseract from "tesseract.js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ตรวจสอบ environment variables
    const channelToken = process.env.LINE_CHANNEL_TOKEN;
    if (!channelToken) {
      console.error("LINE_CHANNEL_TOKEN is missing");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // สร้าง LINE client สำหรับเวอร์ชัน 7.x
    const config = {
      channelAccessToken: channelToken,
      channelSecret: process.env.LINE_CHANNEL_SECRET || "",
    };
    
    const client = new LineSDK.Client(config);

    // ตรวจสอบว่า events มีอยู่ใน body
    if (!body.events || !Array.isArray(body.events)) {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }

    // ประมวลผลแต่ละ event
    for (const event of body.events) {
      if (event.type === "message" && event.message.type === "image") {
        const messageId = event.message.id;

        try {
          // 1) ดึงรูปจาก LINE
          const stream = await client.getMessageContent(messageId);
          
          // แปลง stream เป็น buffer
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);

          // 2) OCR ด้วย Tesseract.js
          console.log("Processing OCR for image:", messageId);
          const result = await Tesseract.recognize(buffer, "eng", {
            logger: (m) => console.log(m),
          });

          const extracted = result.data.text.trim();
          console.log("Extracted text:", extracted);

          // 3) ส่งข้อความกลับไปหา user
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `ค่ามิเตอร์ที่อ่านได้คือ: ${extracted || "ไม่สามารถอ่านค่าได้"}`,
          });
        } catch (error) {
          console.error("Error processing image:", error);
          
          // ส่งข้อความแจ้ง error กลับไปยังผู้ใช้
          try {
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "ขออภัย ไม่สามารถประมวลผลภาพได้ในขณะนี้",
            });
          } catch (replyError) {
            console.error("Failed to send error reply:", replyError);
          }
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