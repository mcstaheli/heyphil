# Project Detail Page - Deep Dive Specification
**Version:** 1.0  
**Created:** March 18, 2026  
**For:** HeyPhil Project Board Enhancement

---

## OVERVIEW

Transform Project Board cards from simple Kanban items into full project management hubs.

**Core Concept:**
- **Kanban Board = Home** (existing view, stays the same)
- **Card → "View Project" button** → Opens dedicated project page
- **Project Page = Full PM Suite** (timeline, budget, files, team, etc.)

---

## PROJECT PAGE LAYOUT

### Top Bar (Always Visible)
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Board     [PROJECT NAME]          Stage: Diligence │
│                                                               │
│ [Overview] [Timeline] [Budget] [Team] [Files] [Notes] [More] │
└─────────────────────────────────────────────────────────────┘
```

**Elements:**
- **Back button** → Return to Kanban
- **Project name** (editable inline)
- **Current stage badge** (synced with Kanban position)
- **Tab navigation** (7 main sections)

---

## TAB 1: OVERVIEW (Default Landing)

**Purpose:** At-a-glance project health dashboard

### Layout:
```
┌──────────────────────┬──────────────────────┐
│  Project Health      │   Quick Stats        │
│  ● On Track          │   Budget: $45K/$50K  │
│                      │   Timeline: 60% done │
│  Owner: Chad         │   Tasks: 12/20 ✓     │
│  Started: Jan 15     │   Team: 4 people     │
│  Due: Apr 30         │                      │
└──────────────────────┴──────────────────────┘

┌─────────────────────────────────────────────┐
│  Key Milestones                             │
│  ✓ Diligence Complete     (Mar 1)          │
│  ◐ Financing Approved      (Mar 25) ← now  │
│  ○ Close Escrow           (Apr 30)         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Recent Activity                            │
│  • Chad updated budget         2 hours ago  │
│  • Greg completed task        yesterday     │
│  • New file uploaded          2 days ago    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Next Actions (Top 3 priorities)            │
│  1. [Chad] Finalize purchase agreement      │
│  2. [Tracy] Submit loan docs                │
│  3. [Greg] Schedule inspection              │
└─────────────────────────────────────────────┘
```

### Data Points:
- **Project Health:** On Track / At Risk / Blocked (manual or auto based on dates/budget)
- **Owner:** Primary person responsible
- **Dates:** Start, target close, actual close
- **Key Stats:** Budget %, Timeline %, Tasks complete
- **Milestones:** 3-5 major phases with status
- **Activity Feed:** Last 10 updates (auto-generated from changes)
- **Next Actions:** Top priorities (pulled from tasks due soon)

---

## TAB 2: TIMELINE (Gantt Chart)

**Purpose:** Visual project schedule with dependencies

### Features:

**Main Gantt View:**
```
Task Name           Owner    Start    End      Progress
├─ Phase 1: Diligence                        [████████──] 80%
│  ├─ Site visit    Chad     Jan 15   Jan 20  [██████████] 100%
│  ├─ Review docs   Tracy    Jan 18   Jan 25  [██████████] 100%
│  └─ Analysis      Greg     Jan 22   Feb 1   [████████──] 90%
├─ Phase 2: Financing                        [████──────] 40%
│  ├─ Loan app      Tracy    Feb 1    Feb 15  [██████████] 100%
│  ├─ Approval      Bank     Feb 15   Mar 25  [████──────] 40% ← now
│  └─ Finalize      Chad     Mar 20   Mar 30  [──────────] 0%
└─ Phase 3: Close                            [──────────] 0%
   ├─ Sign docs     Chad     Apr 1    Apr 5   [──────────] 0%
   └─ Transfer      Escrow   Apr 10   Apr 30  [──────────] 0%

Timeline: Jan ──────── Feb ──────── Mar ──────── Apr ──────→
          ├─────────┤
          Site Visit
                  ├──────────┤
                  Loan Process
                                    ├─────┤
                                    Close
```

**Capabilities:**
- **Drag to adjust dates** (visual date picker)
- **Dependencies:** Task B can't start until Task A completes
- **Milestones:** Diamond markers on timeline
- **Critical Path:** Highlight tasks that affect end date
- **Today Line:** Vertical line showing current date
- **Zoom:** Week / Month / Quarter views
- **Color coding:** By phase, by owner, by status

**Task Detail Popup (click any task):**
- Name
- Owner (dropdown)
- Start/End dates
- % Complete (slider)
- Dependencies (link to other tasks)
- Notes
- Attachments
- Subtasks

**Suggested Library:** 
- **dhtmlxGantt** (robust, commercial)
- **Frappe Gantt** (open source, simpler)
- **react-gantt-timeline** (React-friendly)

---

## TAB 3: BUDGET

**Purpose:** Financial tracking and forecasting

### Layout:
```
┌────────────────────────────────────────────────────┐
│  Budget Summary                                    │
│  Total Budget:      $50,000                        │
│  Actual Spend:      $45,200 (90%)                  │
│  Remaining:         $4,800                         │
│  Status:            ⚠️ At Risk (over 90%)          │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Budget Breakdown                                  │
│  Category           Budget    Actual   Remaining   │
│  ───────────────────────────────────────────────   │
│  Acquisition        $40,000   $40,000   $0         │
│  Due Diligence      $5,000    $3,200    $1,800     │
│  Legal Fees         $3,000    $2,000    $1,000     │
│  Contingency        $2,000    $0        $2,000     │
│  ───────────────────────────────────────────────   │
│  TOTAL              $50,000   $45,200   $4,800     │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Line Items (Recent Expenses)                      │
│  Date      Vendor           Category        Amount │
│  Mar 15    Inspections Inc  Due Diligence   $500   │
│  Mar 10    Smith & Co       Legal Fees      $1,200 │
│  Mar 5     Appraisal Pro    Due Diligence   $400   │
│  [+ Add Expense]                                   │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Forecast                                          │
│  Based on current burn rate:                       │
│  Projected Total: $48,500 (within budget ✓)       │
│  Expected Close Date Impact: None                  │
└────────────────────────────────────────────────────┘
```

### Features:
- **Budget Categories:** Customizable line items
- **Budget vs Actual:** Visual comparison (bar charts)
- **Expense Log:** Detailed transaction history
  - Date, vendor, category, amount, notes
  - Receipt upload
  - Approval status
- **Forecasting:** Projected spend based on timeline
- **Alerts:** Warn when category exceeds 80%
- **Export:** CSV download for accounting

---

## TAB 4: TEAM

**Purpose:** People, roles, and responsibilities

### Layout:
```
┌────────────────────────────────────────────────────┐
│  Project Team                                      │
│                                                    │
│  [Chad Staheli]          Owner / Lead             │
│  chad@philo.ventures     Active                    │
│  Tasks: 8 assigned, 5 complete                     │
│  Last active: 2 hours ago                          │
│  [Message] [View Tasks]                            │
│  ─────────────────────────────────────────────     │
│  [Tracy Stratton]        Finance Lead             │
│  tracy@philo.ventures    Active                    │
│  Tasks: 3 assigned, 2 complete                     │
│  Last active: yesterday                            │
│  [Message] [View Tasks]                            │
│  ─────────────────────────────────────────────     │
│  [+ Add Team Member]                               │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Roles & Responsibilities                          │
│  • Owner: Overall project success (Chad)           │
│  • Finance: Budget, lending (Tracy)                │
│  • Legal: Contracts, compliance (Greg)             │
│  • Operations: Day-to-day (Scott)                  │
│  [Edit Roles]                                      │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  External Contacts                                 │
│  Name              Role              Phone/Email   │
│  John Smith        Broker            555-1234      │
│  Jane Doe          Lender            jane@bank.com │
│  [+ Add Contact]                                   │
└────────────────────────────────────────────────────┘
```

### Features:
- **Team Members:** 
  - Name, email, role
  - Task count (assigned/complete)
  - Activity status
  - Direct message link (if messaging added later)
- **Role Definitions:** Clear RACI (Responsible, Accountable, Consulted, Informed)
- **External Contacts:** Vendors, partners (not full users)
- **Permissions:** View-only vs Edit access (future)

---

## TAB 5: FILES

**Purpose:** Document storage and organization

### Layout:
```
┌────────────────────────────────────────────────────┐
│  📁 Folders                                        │
│  ├─ 📁 Contracts (3 files)                        │
│  ├─ 📁 Due Diligence (12 files)                   │
│  │  ├─ 📁 Inspections (5)                         │
│  │  └─ 📁 Financials (7)                          │
│  ├─ 📁 Legal (8 files)                            │
│  └─ 📁 Photos (24 files)                          │
│  [+ New Folder]                                    │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  📄 Files in: Due Diligence / Inspections         │
│  Name                Type     Size    Uploaded     │
│  Inspection_Report   PDF      2.3MB   Mar 15       │
│  Site_Photos.zip     ZIP      15MB    Mar 14       │
│  Roof_Assessment     PDF      1.1MB   Mar 12       │
│  [⬆️ Upload Files]   [🔗 Add Link]                │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Recent Files                                      │
│  • Purchase_Agreement_v3.pdf      2 hours ago      │
│  • Budget_Spreadsheet.xlsx        yesterday        │
│  • Site_Plan.dwg                  3 days ago       │
└────────────────────────────────────────────────────┘
```

### Features:
- **Folder Structure:** Nested organization
- **File Upload:** Drag & drop or browse
- **File Types:** PDFs, images, spreadsheets, docs, etc.
- **Previews:** Click to preview (in-browser for common types)
- **Download:** Individual or bulk zip
- **Links:** Store URLs (Google Docs, etc.) alongside files
- **Version History:** Track file updates (v1, v2, v3)
- **Search:** Find by filename, type, date
- **Permissions:** (future) Control who can see sensitive files

**Storage Options:**
- **Phase 1:** Store in Google Drive, link via API
- **Phase 2:** AWS S3 or similar for direct upload
- **Database:** Just store metadata (name, url, size, date, uploader)

---

## TAB 6: NOTES

**Purpose:** Project journal, decisions, meeting notes

### Layout:
```
┌────────────────────────────────────────────────────┐
│  📝 Project Notes                                  │
│                                                    │
│  [+ New Note]   Sort by: [Recent ▼]   Filter: All │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Meeting Notes - Lender Call                       │
│  Mar 18, 2026 • Chad Staheli • 2 hours ago         │
│  ─────────────────────────────────────────────     │
│  Discussed loan terms:                             │
│  - 4.5% interest rate approved                     │
│  - Need appraisal by March 25                      │
│  - Underwriting in progress                        │
│                                                    │
│  Next steps:                                       │
│  [ ] Schedule appraisal (Tracy)                    │
│  [ ] Submit income verification (Chad)             │
│                                                    │
│  [Edit] [Delete] [📌 Pin]                          │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Decision Log - Financing Structure                │
│  Mar 10, 2026 • Tracy Stratton                     │
│  ─────────────────────────────────────────────     │
│  Decided to go with Bank A over Bank B:            │
│  - Lower rate (4.5% vs 4.75%)                      │
│  - Faster close (30 days vs 45)                    │
│  - Better terms overall                            │
│                                                    │
│  [Edit] [Delete] [📌 Pin]                          │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Quick Note - Inspection Findings                  │
│  Mar 8, 2026 • Greg                                │
│  ─────────────────────────────────────────────     │
│  Roof needs minor repair (~$5K)                    │
│  Negotiate with seller or add to budget?           │
│                                                    │
│  [Edit] [Delete] [📌 Pin]                          │
└────────────────────────────────────────────────────┘
```

### Features:
- **Note Types:**
  - Meeting notes
  - Decision logs
  - Quick updates
  - Free-form journal
- **Rich Text Editor:** Bold, lists, links, formatting
- **Tagging:** #financing, #legal, #inspection (filter by tag)
- **Pinning:** Keep important notes at top
- **Timestamps:** Auto-logged with author
- **Inline Tasks:** [ ] checkboxes create actionable items
- **Search:** Full-text search across all notes
- **Export:** PDF or Markdown download

---

## TAB 7: CALENDAR

**Purpose:** Project timeline in calendar view

### Layout:
```
┌────────────────────────────────────────────────────┐
│  March 2026                     [Month ▼] [Week]  │
│  Sun  Mon  Tue  Wed  Thu  Fri  Sat                │
│       1    2    3    4    5    6                   │
│       Site      Docs                               │
│       Visit     Review                             │
│  7    8    9    10   11   12   13                  │
│                      Loan  Insp-                   │
│                      App   ection                  │
│  14   15   16   17   18   19   20                  │
│       ●         ●                                  │
│       Lender   Team                                │
│       Call    Meeting                              │
│  21   22   23   24   25   26   27                  │
│                      🏁                            │
│                      Approval                      │
│                      Deadline                      │
│  28   29   30   31                                 │
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  Upcoming Events                                   │
│  Mar 25 • Loan approval deadline (milestone)       │
│  Mar 28 • Team sync meeting                        │
│  Apr 1  • Sign purchase agreement (task)           │
│  [+ Add Event]                                     │
└────────────────────────────────────────────────────┘
```

### Features:
- **View Modes:** Month, Week, Day, Agenda
- **Event Types:**
  - Milestones (from Timeline)
  - Tasks (with due dates)
  - Meetings (custom events)
  - Deadlines
- **Color Coding:** By type or by owner
- **Click Event → Details:** Quick view with option to edit
- **Sync:** Pull from Gantt timeline automatically
- **Export:** iCal download for personal calendar
- **Reminders:** (future) Email/push notifications

---

## ADDITIONAL SECTIONS (Under "More" Tab)

### 8. RISKS & ISSUES

**Purpose:** Track potential problems

```
┌────────────────────────────────────────────────────┐
│  Open Risks (2)                                    │
│  🔴 HIGH: Appraisal may come in low                │
│     Impact: Could derail financing                 │
│     Mitigation: Have backup lender ready           │
│     Owner: Tracy                                   │
│                                                    │
│  🟡 MEDIUM: Inspection repairs > $10K              │
│     Impact: Budget overrun                         │
│     Mitigation: Negotiate with seller              │
│     Owner: Chad                                    │
│  [+ Add Risk]                                      │
└────────────────────────────────────────────────────┘
```

### 9. SETTINGS

**Purpose:** Project configuration

```
┌────────────────────────────────────────────────────┐
│  Project Settings                                  │
│  • Project Name: [Elmwood Acquisition_________]    │
│  • Owner: [Chad Staheli ▼]                         │
│  • Target Close: [Apr 30, 2026]                    │
│  • Budget: [$50,000_____]                          │
│  • Visibility: [Team Only ▼]                       │
│  • Archive Project                                 │
│  • Delete Project (danger!)                        │
└────────────────────────────────────────────────────┘
```

---

## DATABASE SCHEMA ADDITIONS

**New Tables Needed:**

### `projects` (extend existing cards)
```sql
- id
- kanban_card_id (link to existing card)
- owner_id
- start_date
- target_close_date
- actual_close_date
- budget_total
- health_status (on_track, at_risk, blocked)
- created_at
- updated_at
```

### `project_tasks`
```sql
- id
- project_id
- name
- description
- owner_id
- start_date
- end_date
- progress (0-100%)
- parent_task_id (for subtasks)
- dependencies (JSON array of task IDs)
- created_at
- updated_at
```

### `project_budget_items`
```sql
- id
- project_id
- category
- budgeted_amount
- actual_amount
- date
- vendor
- notes
- receipt_url
- created_at
```

### `project_team_members`
```sql
- id
- project_id
- user_id
- role
- permissions (view/edit)
- added_at
```

### `project_files`
```sql
- id
- project_id
- folder_path
- filename
- file_url (Google Drive or S3)
- file_type
- file_size
- uploaded_by
- version
- created_at
```

### `project_notes`
```sql
- id
- project_id
- title
- content (rich text HTML)
- note_type (meeting, decision, update)
- author_id
- tags (JSON array)
- pinned (boolean)
- created_at
- updated_at
```

### `project_events`
```sql
- id
- project_id
- title
- event_type (milestone, meeting, deadline)
- start_datetime
- end_datetime
- attendees (JSON array)
- notes
- created_at
```

---

## PHASED ROLLOUT PLAN

### **PHASE 1: Foundation (Week 1-2)**
- [ ] Add "View Project" button to card modals
- [ ] Create project detail page layout (tabs)
- [ ] Build Overview tab (dashboard)
- [ ] Database schema updates
- [ ] Migration script for existing cards → projects

### **PHASE 2: Core Features (Week 3-4)**
- [ ] Timeline/Gantt chart (use Frappe Gantt to start)
- [ ] Budget tracker (categories, line items)
- [ ] Team management (assign people)
- [ ] Basic task creation

### **PHASE 3: Collaboration (Week 5-6)**
- [ ] Notes system (rich text editor)
- [ ] File storage (Google Drive integration)
- [ ] Calendar view
- [ ] Activity feed

### **PHASE 4: Polish (Week 7-8)**
- [ ] Risks & Issues tracker
- [ ] Advanced permissions
- [ ] Export/reporting
- [ ] Mobile responsive design
- [ ] Performance optimization

---

## UI/UX PRINCIPLES

### Design System:
- **Consistent with Kanban:** Use same color scheme, fonts, spacing
- **Tab Navigation:** Clean, obvious (not buried in dropdowns)
- **Quick Actions:** Floating "+ Add" button on each tab
- **Breadcrumbs:** Always show: Home > Project Board > [Project Name] > [Tab]
- **Auto-save:** Never lose work (save on blur, debounce)
- **Keyboard Shortcuts:** Power users can navigate fast
  - `Cmd+K` → Quick add (task, note, file, etc.)
  - `Tab` → Next section
  - `Esc` → Close modals
- **Loading States:** Skeleton screens, not spinners
- **Empty States:** Helpful "Get Started" prompts

### Mobile Considerations:
- Tabs become dropdown on mobile
- Gantt chart: Horizontal scroll (or switch to list view)
- Touch-friendly buttons (44px min)
- Simplified views (hide less critical data)

---

## OPEN QUESTIONS FOR REFINEMENT

1. **Gantt Library:** Which one? (dhtmlx is powerful but $$$, Frappe is free but simpler)
2. **File Storage:** Google Drive API or build our own with S3?
3. **Real-time Collaboration:** Do multiple people need to edit simultaneously? (WebSockets?)
4. **Notifications:** Email alerts for task assignments, deadline reminders?
5. **Templates:** Pre-built project templates (Real Estate Acquisition, Product Launch, etc.)?
6. **Integrations:** Google Calendar sync? Slack notifications?
7. **Permissions:** Full RBAC (role-based access) or just view/edit for now?
8. **Reporting:** Export to PDF? Weekly summary emails?

---

## SUCCESS METRICS

**How we know this works:**

1. **Adoption:** % of Kanban cards that have project pages created
2. **Engagement:** Avg time spent in project pages vs Kanban
3. **Completeness:** % of projects with budget, timeline, team filled out
4. **Utility:** User feedback → "Can't manage projects without this"
5. **Efficiency:** Reduce time to find project info (before: email/Slack chaos, after: one source of truth)

---

## NEXT STEPS

**To kick off development:**

1. **You review this spec** → Add/remove features, adjust priorities
2. **I create wireframes** → Visual mockups of each tab
3. **Database design** → Finalize schema, write migration scripts
4. **Pick Gantt library** → Install and test in isolation
5. **Build Phase 1** → Overview tab + database foundation
6. **Iterate from there** → Ship small, get feedback, improve

**Ready to refine this and start building?** 🚀
