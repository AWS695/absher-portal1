# أبشر - منصة الخدمات الحكومية الإلكترونية

## Overview
An Arabic government services portal (Absher) that provides electronic services for vehicle registration, license applications, and violation certificates. Features RTL Arabic interface, Discord OAuth authentication, role-based access control, Discord channel notifications, and an admin dashboard.

## Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS, shadcn/ui
- **Backend**: Express.js, Node.js, express-session with PostgreSQL session store
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Discord OAuth2 with server-side sessions
- **Styling**: RTL Arabic support with Cairo font

## Project Structure
```
client/src/
├── components/
│   ├── forms/           # Service request forms
│   ├── layout/          # Header, MainLayout
│   ├── theme-provider   # Dark/light mode
│   └── ui/              # shadcn components + ServiceCard
├── lib/
│   ├── auth.tsx         # Authentication context (session-based)
│   └── queryClient.ts   # TanStack Query setup
└── pages/
    ├── home.tsx         # Homepage with service cards
    ├── login.tsx        # Discord OAuth login
    ├── services.tsx     # Services listing with search
    ├── service-form.tsx # Dynamic service form page
    └── admin/           # Admin dashboard

server/
├── db.ts              # PostgreSQL connection
├── discord.ts         # Discord bot notifications
├── index.ts           # Express app with session middleware
├── routes.ts          # API endpoints
├── middleware/auth.ts # Session-based authentication
└── storage.ts         # Database operations

shared/
└── schema.ts          # Drizzle schemas & Zod validation
```

## Features
1. **Dual Authentication**: Users can login via Discord OAuth2 OR username/password with account activation
2. **Discord Channel Notifications**: New requests sent to Discord with approve/reject buttons
3. **Services** (7 types):
   - تسجيل المركبة (Vehicle Registration)
   - نقل ملكية مركبة (Vehicle Transfer)
   - طلب إزالة حجز (Remove Reservation)
   - طلب رخصة قيادة (Driving License)
   - تسديد مخالفات (Pay Violations)
   - طلب استخراج هوية (ID Card Request)
   - طلب إزالة إيقاف خدمات (Remove Service Suspension)
4. **Admin Dashboard**: Manage users, assign roles, review requests, view audit logs
5. **Dark Mode**: Full dark/light theme support

## Premium Features (2026-01-16)
1. **Advanced Analytics Dashboard**: Interactive charts using Recharts
   - Area chart for requests over time (last 7 days)
   - Pie chart for status distribution (pending/approved/rejected)
   - Bar chart for service breakdown
   - Gradient stat cards with approval rate, completion rate, daily stats
2. **Smart AI Chatbot Assistant**: FAQ-based chatbot with 12 Arabic topics
   - Quick action buttons
   - Typing animation
   - Available for logged-in users only
3. **Print/Export Functionality**: Request tracker page has print and share buttons
   - Native share API support with clipboard fallback
4. **Real-time Notification System**: Bell icon with notification popover
   - Auto-generates notifications from request status changes
   - Mark as read, mark all as read, clear all
   - Persisted in localStorage
   - Polling every 30 seconds for updates
5. **Multi-step Forms with Progress Bar**: Vehicle registration uses 3-step wizard
   - Step navigation with validation
   - Progress indicator
   - Data review before submission
6. **Appointments System**: Calendar-based appointment booking
   - Book appointments for any service type
   - Available time slots (9:00-16:00, excluding Fridays)
   - Cancel appointments
   - View upcoming and past appointments

## Enhanced Admin Features (2026-01-17)
1. **Pending Alerts System**: Yellow warning card showing requests older than 24 hours
   - Quick action buttons to open each pending request
   - Badge counter on Requests tab showing pending count
2. **Enhanced Audit Log**: Timeline-style display with color-coded entries
   - Filter dropdown by action type (user_created, request_created, approved, rejected, role_updated, comment_added)
   - Shows last 20 entries with detailed view
3. **Request Comments System**: Internal notes/comments on requests
   - Add comments (reviewer/admin only)
   - View all comments with timestamps
   - Marked as internal notes
4. **Request History Timeline**: Track all status changes
   - Visual timeline with status transitions
   - Shows previous → new status
   - Timestamps for each change
5. **Tabbed Request Dialog**: 3-tab interface for request details
   - التفاصيل (Details): Request info and approval buttons
   - التعليقات (Comments): Internal comments section
   - التاريخ (History): Status change timeline

## API Endpoints
- `GET /api/auth/discord` - Initiate Discord OAuth2 login (redirects to Discord)
- `GET /api/auth/discord/callback` - Discord OAuth2 callback (exchanges code for token, creates user session)
- `POST /api/auth/register` - Register new user (returns activation token)
- `POST /api/auth/activate` - Activate account with token
- `POST /api/auth/login` - Login with username/password
- `GET /api/auth/me` - Get current user from session
- `POST /api/auth/logout` - Logout (destroy session)
- `GET /api/users` - Get all users (admin only)
- `PATCH /api/users/:id/role` - Update user role (admin only)
- `GET/POST /api/requests` - Request CRUD
- `PATCH /api/requests/:id` - Update request status (reviewer/admin)
- `GET /api/requests/:id/comments` - Get request comments
- `POST /api/requests/:id/comments` - Add comment to request (reviewer/admin)
- `GET /api/requests/:id/history` - Get request history
- `POST /api/discord/interactions` - Discord button interactions
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/pending-alerts` - Get pending requests older than X hours
- `GET /api/audit-logs` - Audit trail
- `GET /api/audit-logs/filter` - Filtered audit logs by action/user/date
- `GET /api/appointments` - Get user's appointments
- `GET /api/appointments/available/:date` - Get available time slots for a date
- `POST /api/appointments` - Create new appointment
- `PATCH /api/appointments/:id/cancel` - Cancel an appointment

## Environment Variables (Secrets)
- `DISCORD_CLIENT_ID` - Discord OAuth client ID
- `DISCORD_CLIENT_SECRET` - Discord OAuth client secret
- `DISCORD_BOT_TOKEN` - Discord bot token for notifications
- `DISCORD_CHANNEL_ID` - Channel ID for request notifications
- `DISCORD_PUBLIC_KEY` - Public key for interaction verification
- `SESSION_SECRET` - Session encryption key

## Running the Project
```bash
npm run dev          # Start development server
npm run db:push      # Push schema to database
```

## User Roles
- **Admin**: Full access to dashboard, can manage users and approve/reject requests
- **Reviewer**: Can review and update request statuses
- **User**: Can submit service requests only

## Security Features
- **Discord OAuth2 authentication**: Users can authenticate via Discord OAuth2 with verified identity
- **Password hashing**: bcrypt with salt for secure password storage (for username/password login)
- **Account activation**: Users must verify with activation token after registration (for username/password)
- **OAuth state parameter**: CSRF protection for OAuth flow using random state verification
- **Session-based authentication**: Server-side sessions stored in PostgreSQL (connect-pg-simple)
- **httpOnly cookies**: Session cookies are httpOnly with sameSite=lax for CSRF protection
- **Discord signature verification**: Interaction endpoint verifies Discord signatures using ed25519
- **Server-side userId derivation**: Request submissions derive userId from session, preventing impersonation
- **Role-based authorization middleware**: Admin/reviewer routes protected with requireAdmin/requireReviewer
- **Zod validation**: All API endpoints validate request bodies using Zod schemas
- **Audit logging**: All user actions are logged with timestamps

## Discord Setup
1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and copy the token
3. Add the bot to your server with Send Messages and Embed Links permissions
4. Set Interactions Endpoint URL: `https://YOUR-DOMAIN/api/discord/interactions`
5. Copy PUBLIC KEY from General Information

## Recent Updates
- 2026-01-17: Added dual authentication (Discord OAuth + username/password)
- 2026-01-17: Added registration page with activation token system
- 2026-01-17: Password hashing with bcrypt for security
- 2026-01-16: Added Discord channel notifications with approve/reject buttons
- 2026-01-16: Added Discord signature verification for interactions
- 2026-01-16: Removed stats cards from homepage (kept in admin dashboard)
- 2026-01-16: Security hardening - sessions with httpOnly/sameSite cookies
