# Campus Notify – Google Classroom Messenger Bot

Campus Notify is a personal assistant for Google Classroom that delivers assignments, materials, and announcements directly to Facebook Messenger. It also provides multi-window reminders and a “late/missing” notification if assignments aren’t submitted on time.

## Project Summary

This project was conceived and designed by Sabbir Hossain Osmani. Development and debugging were powered by AI tools such as GPT-5-mini, Gemini AI, and other models. The final delivery is clean, reliable, and user-friendly.

## Features

--Secure Google OAuth2 login for students

--Syncs classroom information (assignments, materials, announcements) via Redis

--Immediate notifications for new assignments or materials

--Smart reminders at 36 h, 12 h, 6 h, and 2 h before due date

--Late/missing alert one minute after the deadline if not submitted

--Natural language search support (e.g. by course, date, keyword)

--Messenger-friendly formatting: courses, titles, deadlines, and direct links

--Browsable lists with counts and pagination where needed

## 🛠 Technology Stack

--Node.js (ES Modules)

--Google Classroom API (with OAuth2 for authentication)

--Facebook Messenger Platform API

--Redis REST API (for quick storage & indexing)

--AI Assistance: GPT-5-mini, Gemini AI, and other Large Language Models

## Installation Guide

```bash
git clone https://github.com/osmani-ghost/campus-notify.git
cd campus-notify
npm install
```

### Create a .env file with:

```bash
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_REDIRECT_URI=<your-redirect-uri>
MESSENGER_PAGE_ACCESS_TOKEN=<your-facebook-messenger-token>
PUBLIC_URL=<your-domain>  # e.g., https://example.vercel.app
REDIS_REST_URL=<redis-rest-url>
REDIS_REST_TOKEN=<redis-rest-token>
```

## Running the Bot

--Development Mode: npm run dev

--Production Mode: npm run start

### Once deployed:

--A user triggers login via Messenger

--Bot fetches classroom data and stores state in Redis

--Users interact with commands or natural-language queries in Messenger

--Bot manually or automatically responds (via cron) with reminders or content

## Command Reference

```bash
| Command                                               | Description                                    |
| ----------------------------------------------------- | ---------------------------------------------- |
| `assignments`                                         | Lists assignments due                          |
| `materials`                                           | Lists course materials                         |
| `announcements`                                       | Lists recent announcements                     |
```

## Debugging & Logs

### Detailed logs are baked in for:

--Webhook processing

--OAuth and Google Classroom API interactions

--Redis operations (tracking reminders, context, tokens)

--Cron job actions (new items, reminders, missing alerts)

## Security & Privacy

--Refresh tokens and credentials are stored securely in Redis

--If exposed, tokens can be revoked instantly

--Messages are only sent to authenticated, mapped Messenger PSIDs

## Acknowledgements

--Project Design & Ideas: osmani-ghost

--Code Support & Debugging: GPT-5-mini (OpenAI), Gemini AI, and other LLMs

--APIs: Google Classroom API, Facebook Messenger AP

## License

[MIT](https://choosealicense.com/licenses/mit/)
