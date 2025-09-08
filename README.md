Campus Notify - Google Classroom Messenger Bot

Campus Notify is a personal Google Classroom assistant that integrates directly with Facebook Messenger.
It fetches assignments, materials, and announcements from Google Classroom and delivers them in real time to Messenger, with reminders and natural language search support.

Project Credits

Project Idea & Feature Design: Sabbir Hossain Osmani

Code Writing & Debugging Assistance: GPT-5 (OpenAI), Gemini AI, and other AI models

Features

Secure Google OAuth2 login for students.

Fetch, index, and store classroom assignments, announcements, and materials using Redis.

Real-time notifications for new assignments, announcements, and materials.

Automatic assignment reminders at 12 hours, 6 hours, and 2 hours before deadlines (skips already submitted work).

Natural language search for assignments, announcements, and materials.

Clean Messenger message formatting with course name, title, due date, and direct links.

Top results display with counts for larger lists.

Extensive debug logging for every API call and event.

Tech Stack

Node.js (ES Modules) – Core backend

Redis – Fast storage, caching, and indexing

Messenger Platform API – Facebook Messenger integration

Google Classroom API – OAuth2 authentication and data fetching

AI Assistance – GPT-5, Gemini AI, and other LLMs for code generation and debugging

Installation

Clone the repository:

git clone https://github.com/osmani-ghost/campus-notify.git
cd campus-notify
npm install

Create a .env file in the root directory with the following:

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google
MESSENGER_PAGE_ACCESS_TOKEN=your-page-access-token
PUBLIC_URL=https://your-domain.com
REDIS_URL=redis://localhost:6379

Running the Bot

For local development:

npm run dev

For production:

npm run start

Once running:

Log in with Google on Messenger.

The bot will automatically fetch and index all Google Classroom content.

Query assignments, announcements, and materials using commands or natural language.

Commands
Command Description
materials- List recent course materials

Natural language queries Example: "Show Math assignments due tomorrow"
Debugging & Logs

Verbose logs for Messenger webhooks, API requests, and internal cron jobs.

Detailed logs for Google ID mapping, PSID lookup, date filtering, and search results.

Helps identify issues with indexing, reminders, or message delivery.

Security

Google OAuth2 refresh tokens and user credentials stored securely in Redis.

Tokens can be revoked immediately if compromised.

Messages are only sent to authorized and mapped Messenger users.

Credits

Project Idea & Implementation Flow: Sabbir Hossain Osmani

Code Writing & Debugging: GPT-5 (OpenAI), Gemini AI, and other AI models

APIs Used: Google Classroom API, Facebook Messenger API

The idea, feature set, and project design are the original work of Sabbir Hossain Osmani. AI models provided assistance in code writing and debugging.

License

MIT License © 2025 osmani-ghost

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, provided that the above copyright notice and this permission notice are included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND.
