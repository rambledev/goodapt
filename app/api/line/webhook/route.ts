import { NextRequest, NextResponse } from "next/server";
import * as LineSDK from "@line/bot-sdk";
import Tesseract from "tesseract.js";

// ต้องใช้ NextRequest แทน Request
export async function GET(request: NextRequest) {
  console.log("LINE WEBHOOK VERIFY (GET)");
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export async function POST(request: NextRequest) {
  console.log("LINE WEBHOOK RECEIVED (POST)");

  try {
    // ตรวจสอบ環境变量
    const channelToken = process.env.LINE_CHANNEL_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelToken || !channelSecret) {
      console.error("MISSING ENV:", {
        token: !!channelToken,
        secret: !!channelSecret,
      });
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // อ่าน raw body สำหรับ LINE signature verification
    const body = await request.text();
    console.log("Raw body length:", body.length);

    // ถ้า body ว่าง = LINE verify request
    if (!body || body.trim() === "") {
      console.log("EMPTY BODY → LINE VERIFY");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Parse JSON
    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch (err) {
      console.log("INVALID JSON → returning 200");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    console.log("Parsed body:", JSON.stringify(parsedBody, null, 2));

    // ตรวจสอบ signature (สำคัญ!)
    const signature = request.headers.get("x-line-signature");
    if (!signature) {
      console.error("NO SIGNATURE HEADER");
      return NextResponse.json({ error: "No signature" }, { status: 400 });
    }

    // ตรวจสอบ events
    if (!parsedBody.events || !Array.isArray(parsedBody.events)) {
      console.log("NO EVENTS ARRAY");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // Initialize LINE client
    const client = new LineSDK.Client({
      channelAccessToken: channelToken,
      channelSecret: channelSecret,
    });

    // Process each event
    for (const event of parsedBody.events) {
      console.log("Processing event:", event.type);

      // 1. ตอบกลับข้อความธรรมดา
      if (event.type === "message" && event.message.type === "text") {
        console.log("Text message:", event.message.text);
        
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `ได้รับข้อความ: ${event.message.text}`,
        });
      }

      // 2. ประมวลผลภาพ
      if (event.type === "message" && event.message.type === "image") {
        console.log("Image message received, ID:", event.message.id);

        try {
          // ดาวน์โหลดภาพจาก LINE
          const stream = await client.getMessageContent(event.message.id);
          
          // Convert stream to buffer
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          const imageBuffer = Buffer.concat(chunks);

          console.log("Image downloaded, size:", imageBuffer.length);

          // OCR ด้วย Tesseract
          console.log("Starting OCR...");
          const { data: { text } } = await Tesseract.recognize(
            imageBuffer,
            'eng+tha', // อังกฤษ + ไทย
            {
              logger: m => console.log(m.status)
            }
          );

          const extractedText = text.trim();
          console.log("OCR Result:", extractedText);

          // ส่งผลลัพธ์กลับ
          let replyText = "ไม่พบข้อความในภาพ";
          if (extractedText) {
            // กรองหาเฉพาะตัวเลข (สำหรับมิเตอร์ไฟ)
            const numbers = extractedText.match(/\d+/g);
            if (numbers && numbers.length > 0) {
              replyText = `ค่ามิเตอร์: ${numbers.join(', ')}`;
            } else {
              replyText = `อ่านได้: ${extractedText.substring(0, 100)}...`;
            }
          }

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: replyText
          });

        } catch (error) {
          console.error("Image processing error:", error);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "เกิดข้อผิดพลาดในการประมวลผลภาพ"
          });
        }
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });

  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ป้องกัน Next.js caching
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // ใช้ Node.js runtime สำหรับ Tesseract