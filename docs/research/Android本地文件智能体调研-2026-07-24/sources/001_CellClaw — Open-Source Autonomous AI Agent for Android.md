---
title: "CellClaw — Open-Source Autonomous AI Agent for Android"
source: "https://cellclaw.com/"
imported_at: "2026-07-24T20:45:57"
clip_type: "webpage"
---

# CellClaw — Open-Source Autonomous AI Agent for Android

来源: https://cellclaw.com/

CellClaw

Features Tools Interact Providers Security [ GitHub ](https://github.com/jordanthejet/cellclaw)

Open Source · Apache 2.0

# Your Phone.
Your AI.
No Cloud Required.

CellClaw is an open-source, autonomous AI agent that runs natively on Android. 33 tools, 5 interaction methods, zero backend servers. Your phone talks directly to your chosen AI provider.

[ View on GitHub ](https://github.com/jordanthejet/cellclaw) Learn More

33 Tools

5 Interaction Methods

4 LLM Providers

0 Backend Servers

Scroll to explore

Features

## An AI That Actually Controls Your Phone

Not just a chatbot. CellClaw is a full autonomous agent with deep Android integration.

### Autonomous Agent Loop

LLM-driven tool-use loop that thinks, acts, and iterates until the task is done. No hand-holding required.

### Full Device Control

Tap, type, swipe, screenshot, launch apps, read screens — all via Android Accessibility in a separate process for stability.

### SMS, Calls & Messaging

Read and send SMS, make calls, open WhatsApp/Telegram/Instagram chats, read and reply to messages across apps.

### Computer Vision

Screenshots analyzed by vision-capable LLMs. See what's on screen, understand UI elements, and act on visual information.

### Persistent Memory

Room database stores conversations, memory facts, and scheduled tasks. Your AI remembers context across sessions.

### Long-Running Tasks

Heartbeat system with adaptive polling keeps tasks alive. Start an automation and walk away — CellClaw keeps working.

### Wake Word Detection

Say "CellClaw" to activate hands-free. On-device TensorFlow Lite model — no cloud processing for wake word.

### Custom Skills

Define reusable workflows in Markdown. Trigger keywords activate multi-step automations without reprompting.

33 Tools

## Every Tool Your AI Needs

From sending texts to controlling the camera — organized across 8 categories.

### Communication

  * `sms.read` `sms.send`
  * `phone.call` `phone.log`
  * `email.send`



### Contacts & Calendar

  * `contacts.search` `contacts.add`
  * `calendar.query` `calendar.create`



### Screen & App Control

  * `screen.read` `screen.capture`
  * `app.launch` `app.automate`
  * `vision.analyze`



### Cross-App Messaging

  * `messaging.open`
  * `messaging.read`
  * `messaging.reply`



### Files & Clipboard

  * `file.read` `file.write` `file.list`
  * `clipboard.read` `clipboard.write`



### Device & Sensors

  * `location.get` `sensor.read`
  * `camera.snap` `camera.record`
  * `settings.get`



### Web & Browser

  * `browser.open`
  * `browser.search`



### System & Memory

  * `notification.listen` `notification.send`
  * `script.exec` `schedule.manage`
  * `memory.store` `memory.recall`



5 Ways to Interact

## Talk to CellClaw Your Way

Chat, tap, speak, or swipe — CellClaw meets you where you are.

01

### Chat Screen

Full conversation interface with real-time tool execution status and streaming responses.

02

### Floating Overlay

Draggable bubble for quick questions without leaving your current app. Double-tap to expand.

03

### Notification Reply

Reply directly from the persistent notification. No need to open the app at all.

04

### Quick Settings Tile

Toggle CellClaw from the notification shade — check agent status at a glance.

05

### Wake Word

Say "CellClaw" to activate hands-free. On-device TensorFlow Lite — no cloud needed.

Your AI, Your Choice

## Bring Your Own AI Provider

No vendor lock-in. No CellClaw servers. Your phone talks directly to the provider you choose.

Anthropic

Claude Sonnet 4.6 · Opus 4.6 · Haiku 4.5

Default

OpenAI

GPT-5.2 · GPT-5-mini · GPT-4.1 · GPT-4.1-mini

Google Gemini

Gemini 3.1 Pro · Gemini 3 Flash · Gemini 2.5 Flash/Pro

OpenRouter

Any model available on OpenRouter

Multi-model

Security First

## Powerful But Safe

Three autonomy profiles, per-app access control, biometric gates, and encrypted key storage.

### Full Auto

All tools auto-approved. For power users who trust their automations.

Recommended

### Balanced

Reads auto-approved. Writes, sends, and destructive actions require your approval.

### Cautious

Only basic reads auto-approved. Everything else needs explicit permission.

AES-256-GCM encrypted key storage via Android Keystore

Per-app allow/block lists for tool execution

Optional biometric authentication for sensitive operations

No backend servers — your data never touches CellClaw infrastructure

Under the Hood

## How the Agent Loop Works

A simple but powerful cycle: think, act, observe, repeat.

1

### You Send a Message

Via chat, overlay, notification, or wake word

2

### LLM Thinks

System prompt + history + 33 tool schemas sent to your chosen provider

3

### Tools Execute

Checked against autonomy policy + app access control. Auto-approve or ask you.

4

### Loop Continues

Results feed back to the LLM. Repeats until the task is done (text-only response).

## Ready to Give Your Phone a Brain?

CellClaw is open source under Apache 2.0. Clone it, build it, make it yours.

[ Star on GitHub ](https://github.com/jordanthejet/cellclaw) [Contribute](https://github.com/jordanthejet/cellclaw/issues)

Want the power without the API key setup? [CellBreak](https://cellbreak.app) gives you the full CellClaw experience with optional managed credits — no keys required.

Kotlin 2.1 Jetpack Compose Hilt Room TensorFlow Lite Apache 2.0

CellClaw

[GitHub](https://github.com/jordanthejet/cellclaw) [Issues](https://github.com/jordanthejet/cellclaw/issues) [License](https://github.com/jordanthejet/cellclaw/blob/main/LICENSE) [Privacy](/privacy)

© 2026 CellClaw. Open source under Apache 2.0.
