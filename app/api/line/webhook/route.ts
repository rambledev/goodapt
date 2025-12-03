import { NextRequest, NextResponse } from "next/server";
import * as LineSDK from "@line/bot-sdk";
import Tesseract from "tesseract.js";

// Helper สำหรับ debug
const debugLog = (...args: any[]) => {
  console.error("🔍 WEBHOOK DEBUG:", ...args);
};

export async function GET(request: NextRequest) {
  debugLog("GET request - LINE verify");
  return NextResponse.json({ status: "ok" }, { status: 200 });
}

export async function POST(request: NextRequest) {
  debugLog("=== NEW WEBHOOK REQUEST ===");
  
  try {
    // 1. Log headers สำหรับ debug
    const headers = Object.fromEntries(request.headers.entries());
    debugLog("Headers received");
    
    // 2. Check environment variables
    const channelToken = process.env.LINE_CHANNEL_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    
    if (!channelToken || !channelSecret) {
      console.error("❌ MISSING ENV VARIABLES");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }
    
    debugLog("Env check OK");
    
    // 3. อ่าน raw body
    const bodyText = await request.text();
    debugLog("Body length:", bodyText.length);
    
    if (!bodyText || bodyText.trim() === "") {
      debugLog("Empty body - verification request");
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    
    // 4. Parse JSON
    let parsedBody;
    try {
      parsedBody = JSON.parse(bodyText);
      debugLog("JSON parsed successfully");
    } catch (err) {
      debugLog("JSON parse error");
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    
    // 5. ตรวจสอบ signature (ข้ามไปได้ถ้าเป็น testing)
    const signature = request.headers.get("x-line-signature");
    
    if (!signature) {
      debugLog("⚠️ No signature header - could be test request");
      // ไม่ต้อง error ถ้าไม่มี signature, อาจเป็นการทดสอบ
      // แต่ถ้าเป็น production จาก LINE จริง จะมี signature เสมอ
    } else {
      debugLog("✓ Signature found, would verify here");
      // ใน production ควร verify signature
      // const isValid = LineSDK.validateSignature(bodyText, channelSecret, signature);
      // if (!isValid) { return NextResponse.json({ error: "Invalid signature" }, { status: 401 }); }
    }
    
    // 6. ตรวจสอบ events
    if (!parsedBody.events || !Array.isArray(parsedBody.events)) {
      debugLog("No events array in body");
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    
    debugLog(`Processing ${parsedBody.events.length} event(s)`);
    
    // 7. Initialize LINE client
    const client = new LineSDK.Client({
      channelAccessToken: channelToken,
      channelSecret: channelSecret,
    });
    
    // 8. Process each event
    const promises = parsedBody.events.map(async (event: any, index: number) => {
      debugLog(`[Event ${index}] Type: ${event.type}`);
      
      if (event.type === "message") {
        debugLog(`[Event ${index}] Message type: ${event.message.type}`);
        
        // ตอบกลับข้อความ text
        if (event.message.type === "text") {
          debugLog(`[Event ${index}] Text: ${event.message.text}`);
          
          try {
            // ถ้ามี replyToken (มาจาก LINE จริง) ให้ตอบกลับ
            if (event.replyToken) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: `ได้รับข้อความ: "${event.message.text}"`
              });
              debugLog(`[Event ${index}] Reply sent`);
            } else {
              debugLog(`[Event ${index}] No replyToken (test request)`);
            }
          } catch (error) {
            console.error(`[Event ${index}] Reply error:`, error);
          }
        }
        
        // ประมวลผลภาพ
        if (event.message.type === "image") {
          debugLog(`[Event ${index}] Image message ID: ${event.message.id}`);
          
          try {
            // ดาวน์โหลดภาพ
            const stream = await client.getMessageContent(event.message.id);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              chunks.push(Buffer.from(chunk));
            }
            const imageBuffer = Buffer.concat(chunks);
            
            debugLog(`[Event ${index}] Image downloaded: ${imageBuffer.length} bytes`);
            
            // OCR
            const { data: { text } } = await Tesseract.recognize(
              imageBuffer,
              'eng',
              { logger: m => debugLog(`[Event ${index}] OCR: ${m.status}`) }
            );
            
            const extractedText = text.trim();
            debugLog(`[Event ${index}] OCR result: ${extractedText}`);
            
            // ส่งผลลัพธ์กลับ
            if (event.replyToken) {
              let replyText = "ไม่พบตัวเลขในภาพ";
              const numbers = extractedText.match(/\d+/g);
              
              if (numbers && numbers.length > 0) {
                replyText = `อ่านได้ตัวเลข: ${numbers.join(', ')}`;
              } else if (extractedText) {
                replyText = `ข้อความในภาพ: ${extractedText.substring(0, 50)}...`;
              }
              
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: replyText
              });
            }
            
          } catch (error) {
            console.error(`[Event ${index}] Image processing error:`, error);
            
            if (event.replyToken) {
              await client.replyMessage(event.replyToken, {
                type: "text",
                text: "เกิดข้อผิดพลาดในการประมวลผลภาพ"
              });
            }
          }
        }
      }
    });
    
    await Promise.all(promises);
    
    debugLog("=== PROCESSING COMPLETE ===");
    return NextResponse.json({ 
      ok: true,
      processed: true,
      eventCount: parsedBody.events.length
    }, { status: 200 });
    
  } catch (error) {
    console.error("❌ UNHANDLED ERROR IN WEBHOOK:", error);
    // ยังต้องตอบ 200 เพื่อไม่ให้ LINE ยิงซ้ำ
    return NextResponse.json({ 
      ok: true,
      error: "Internal error but acknowledged"
    }, { status: 200 });
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';