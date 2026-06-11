# Omegle Clone

Anonymous random text & video chat application built with Node.js, Express, Socket.io, and WebRTC.

## Features

- Random text chat with strangers
- WebRTC video calling
- Real-time messaging with Socket.io
- Typing indicators
- Anonymous - no login required
- No database - in-memory matching
- Responsive dark theme UI
- Rate limiting and input sanitization

## Deployment to Render

1. Push this repository to GitHub
2. Go to [dashboard.render.com](https://dashboard.render.com)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Use these settings:
   - **Name**: `omegle-clone`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/`
6. Click "Create Web Service"

No environment variables are required. The app runs on port 3000 by default, and Render will override this automatically.

## Local Development

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

## Project Structure

```
omegle-clone/
├── public/
│   ├── index.html      # Frontend UI
│   ├── style.css       # Styling
│   └── app.js          # Client-side logic
├── server.js           # Express + Socket.io server
├── package.json        # Dependencies
├── render.yaml         # Render config
└── README.md           # Documentation
```

## How It Works

1. Users connect to the site and click "Start Chat"
2. They are placed in a waiting queue
3. When two users are waiting, they are matched into a private room
4. Users can text chat, video call, or click "Next" to find a new stranger
5. WebRTC enables peer-to-peer video using STUN servers for NAT traversal
