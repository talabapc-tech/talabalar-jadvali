import { NextResponse } from 'next/server'

function maskKey(key?: string): string {
  if (!key) return ''
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`
}

export async function GET() {
  const serverEnv = {
    openrouter: {
      isSet: !!process.env.OPENROUTER_API_KEY,
      masked: maskKey(process.env.OPENROUTER_API_KEY),
    },
    telegram: {
      isSet: !!process.env.TELEGRAM_BOT_TOKEN,
      masked: maskKey(process.env.TELEGRAM_BOT_TOKEN),
      chatId: process.env.TELEGRAM_CHAT_ID ? `${process.env.TELEGRAM_CHAT_ID.slice(0, 4)}••••` : '',
      channelId: process.env.TELEGRAM_CHANNEL_ID ? `${process.env.TELEGRAM_CHANNEL_ID.slice(0, 4)}••••` : '',
    },
    webjurnal: {
      isSet: !!process.env.WEBJURNAL_API_KEY || !!process.env.WEBJURNAL_API_URL,
      url: process.env.WEBJURNAL_API_URL || 'https://webjurnal.uz',
      maskedKey: maskKey(process.env.WEBJURNAL_API_KEY),
    },
    mytest: {
      isSet: !!process.env.MYTEST_ROSTER_TOKEN,
      masked: maskKey(process.env.MYTEST_ROSTER_TOKEN),
    },
    github: {
      isSet: !!process.env.GITHUB_TOKEN,
      masked: maskKey(process.env.GITHUB_TOKEN),
      repo: process.env.GITHUB_REPO || 'talabapc-tech/talabalar-jadvali',
    },
    supabase: {
      isSet: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY,
      url: process.env.SUPABASE_URL ? 'https://••••.supabase.co' : '',
    },
  }

  return NextResponse.json({ ok: true, serverEnv })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: string
    apiKey?: string
    model?: string
    token?: string
    chatId?: string
  } | null

  const action = body?.action

  if (action === 'test_ai') {
    const key = (typeof body?.apiKey === 'string' && body.apiKey.trim())
      ? body.apiKey.trim()
      : process.env.OPENROUTER_API_KEY

    if (!key) {
      return NextResponse.json(
        { ok: false, error: "OpenRouter API kaliti topilmadi (sozlamalarda yoki .env da kiriting)" },
        { status: 400 },
      )
    }

    const model = (typeof body?.model === 'string' && body.model.trim())
      ? body.model.trim()
      : 'google/gemini-3.8-flash'

    const startTime = Date.now()
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://talabalar-jadvali.vercel.app',
          'X-Title': 'Talabalar Portali',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: "Salom! Faqat bir so'z bilan javob ber: Aloqa bor." }],
          max_tokens: 30,
        }),
        signal: AbortSignal.timeout(20_000),
      })

      const latencyMs = Date.now() - startTime

      if (!res.ok) {
        const errText = await res.text()
        let parsedMsg = errText.slice(0, 200)
        try {
          const errJson = JSON.parse(errText) as { error?: { message?: string } }
          if (errJson?.error?.message) parsedMsg = errJson.error.message
        } catch { /* ignore */ }
        return NextResponse.json({
          ok: false,
          error: `OpenRouter xatosi (${res.status}): ${parsedMsg}`,
          latencyMs,
          model,
        }, { status: 400 })
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const answer = json?.choices?.[0]?.message?.content?.trim() || 'Aloqa bor'

      return NextResponse.json({
        ok: true,
        latencyMs,
        reply: answer,
        model,
      })
    } catch (e) {
      const latencyMs = Date.now() - startTime
      return NextResponse.json({
        ok: false,
        error: `Bog'lanishda xatolik: ${(e as Error).message}`,
        latencyMs,
        model,
      }, { status: 502 })
    }
  }

  if (action === 'test_telegram') {
    const token = (typeof body?.token === 'string' && body.token.trim())
      ? body.token.trim()
      : process.env.TELEGRAM_BOT_TOKEN

    if (!token) {
      return NextResponse.json({ ok: false, error: "Telegram bot token kiritilmagan" }, { status: 400 })
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      })
      const data = (await res.json()) as {
        ok: boolean
        description?: string
        result?: { id: number; username?: string; first_name?: string }
      }
      if (!data.ok || !data.result) {
        return NextResponse.json({ ok: false, error: data.description || 'Telegram xatosi' }, { status: 400 })
      }
      return NextResponse.json({
        ok: true,
        bot: {
          id: data.result.id,
          username: data.result.username,
          first_name: data.result.first_name,
        },
      })
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Telegram ulanmadi: ${(e as Error).message}` }, { status: 502 })
    }
  }

  return NextResponse.json({ ok: false, error: "Noma'lum amal" }, { status: 400 })
}
