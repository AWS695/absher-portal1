# Design Guidelines: Arabic Government Services Portal

## Design Approach
**Selected Framework:** Material Design with government portal adaptations
**Rationale:** Information-dense government service platform requiring trust, clarity, and accessibility. Material Design provides robust form patterns, clear hierarchy, and established RTL support essential for Arabic interfaces.

**RTL Considerations:** All layouts mirror horizontally for Arabic. Navigation flows right-to-left, icons flip appropriately, forms align right.

---

## Core Design Elements

### Typography
**Primary Font:** Cairo or Tajawal (Arabic-optimized Google Fonts)
- Headings: 700 weight, sizes: 2xl (forms), 3xl (page titles), 4xl (hero)
- Body: 400 weight, base and lg sizes
- Labels: 500 weight, sm size
- Buttons: 600 weight, base size

### Layout System
**Spacing Units:** Tailwind 4, 6, 8, 12, 16, 24 for consistent rhythm
- Section padding: py-16 md:py-24
- Card padding: p-6 md:p-8
- Form field spacing: space-y-6
- Container max-width: max-w-7xl

---

## Component Library

### Navigation
**Top Bar (Sticky):**
- Logo right-aligned, navigation items left-aligned
- User avatar + Discord name in dropdown (far left)
- Notification bell icon with badge counter
- Elevated shadow on scroll (shadow-md)

### Service Cards (Homepage)
**Grid Layout:** grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
**Card Structure:**
- Icon container: 60x60px, background subtle, rounded-xl
- Service title: text-xl font-bold
- Short description: text-gray-600, 2 lines max
- Primary button: Full-width, rounded-lg
- Hover: Lift effect (shadow-lg, scale-105 transition)

### Form Components
**Container:** max-w-3xl mx-auto, bg-white rounded-2xl shadow-lg p-8
**Input Fields:**
- Label above input, font-medium text-sm mb-2
- Input: rounded-lg border-2 border-gray-200 focus:border-blue-500
- Height: h-12, px-4
- File upload: Dashed border zone with upload icon, drag-drop area

**Validation:**
- Success: Green border + checkmark icon
- Error: Red border + error message below in text-red-600 text-sm

**Action Buttons:**
- Primary (Submit): bg-blue-600, min-w-32, h-12, rounded-lg
- Secondary (Cancel): bg-gray-100 text-gray-700, outlined variant

### Admin Dashboard
**Sidebar:** w-64, bg-gray-50 border-l (RTL), fixed height
- Section headers with dividers
- Menu items with icons + text, active state with bg-blue-50
- User management, requests review, statistics sections

**Main Content Area:**
- Stats cards: Grid of 4 cards showing metrics (total requests, pending, approved, rejected)
- Data tables: Striped rows, sortable headers, action dropdowns
- Pagination: Bottom-centered, 1 2 3 ... pattern

### Request Review Interface
**Two-column layout (50/50):**
- Left: Request details (read-only form fields)
- Right: Review actions panel (approve/reject buttons, comment textarea, audit log)
- Status badge: Pill-shaped, color-coded (yellow=pending, green=approved, red=rejected)

---

## Page Structures

### Homepage (Logged In)
- Hero section: 60vh, gradient background, welcome message + user stats
- Services grid below: 6-9 service cards
- Quick actions footer: Recent submissions widget

### Service Forms
- Breadcrumb navigation top
- Form in centered container (max-w-3xl)
- Progress indicator if multi-step
- Sticky submit bar at bottom on mobile

### Admin Dashboard
- Sidebar navigation (fixed)
- Top stats overview (4 metrics cards)
- Main content: Tabs for different views (All Requests, Users, Audit Log)

---

## Interactions

### Notifications
**Toast Messages:**
- Top-center position
- Success: Green accent with checkmark
- Error: Red accent with X icon
- Auto-dismiss after 5s
- Slide-in animation from top

### Discord Integration
**OAuth Button:**
- Discord brand color (#5865F2)
- Discord icon + "تسجيل الدخول عبر Discord" text
- Prominent on login page, rounded-lg, px-8 py-3

### Loading States
- Skeleton screens for data tables
- Spinner overlay for form submissions
- Progress bar for file uploads

---

## Accessibility
- All forms fully keyboard navigable
- ARIA labels in Arabic for screen readers
- Focus indicators: 2px blue ring offset
- Minimum touch targets: 44x44px
- Color contrast: WCAG AA minimum

---

## Images
**Hero Section:** 
Yes, include large background image (abstract geometric patterns or Saudi Arabia landmarks, subtle overlay for text readability). Hero buttons use backdrop-blur-md bg-white/20 backgrounds.

**Service Icons:**
Use Font Awesome (RTL-compatible) via CDN for service card icons. Size: fa-2x.