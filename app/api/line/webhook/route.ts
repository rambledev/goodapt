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
    // อ่าน raw body
    let raw = null;
    try {
      const buf = await req.arrayBuffer();
      raw = Buffer.from(buf);
    } catch {
      raw = null;
    }

    // ถ้าไม่มี body = LINE verify → ต้องตอบ 200
    if (!raw || raw.length === 0) {
      console.log("LINE VERIFY DETECTED: empty POST");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // พยายาม parse JSON (ถ้าไม่ใช่ JSON → ก็ยังต้องตอบ 200)
    let body: any = {};
    try {
      body = JSON.parse(raw.toString("utf-8"));
    } catch (err) {
      console.log("NOT JSON BODY → treating as verify");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ไม่มี events = ไม่ใช่ webhook event
    if (!body.events) {
      console.log("NO EVENTS → verify or system request");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // โหลด ENV
    const channelToken = process.env.LINE_CHANNEL_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;

    if (!channelToken) {
      console.error("ERROR: Missing LINE_CHANNEL_TOKEN");
      return NextResponse.json({ ok: true }, { status: 200 }); // เพื่อ verify ผ่าน
    }

    const client = new LineSDK.Client({
      channelAccessToken: channelToken,
      channelSecret: channelSecret ?? "",
    });

    // LOOP events
    for (const event of body.events) {
      if (event.type === "message" && event.message.type === "image") {
        console.log("Image message received:", event.message.id);

        try {
          const stream = await client.getMessageContent(event.message.id);

          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }

          const buffer = Buffer.concat(chunks);

          const result = await Tesseract.recognize(buffer, "eng");
          const extracted = result.data.text.trim();

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `ค่ามิเตอร์: ${extracted || "อ่านไม่สำเร็จ"}`,
          });
        } catch (e) {
          console.error("OCR/Reply Error:", e);

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "ประมวลผลภาพไม่สำเร็จ",
          });
        }
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("FATAL UNEXPECTED ERROR:", err);
    return NextResponse.json({ ok: true }, { status: 200 }); // เพื่อ verify ผ่าน
  }
}



export const dynamic = "force-dynamic";