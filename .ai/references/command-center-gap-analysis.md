# Command Center gap analysis vs. field-service platforms — 2026-09-28

Load this when scoping new internal (Command Center) features. It compares Clearview's internal tooling against Jobber, Housecall Pro and ServiceTitan, and ranks gaps by how directly they produce revenue. It is a planning input only. Nothing here is committed scope.

## Evidence quality

Most published numbers come from vendors or agencies selling the fix. Treat them as direction, not as a forecast. The strongest sources are the Oldroyd/MIT lead-response study (old, but the effect has been replicated widely) and BrightLocal's consumer review survey. Vendor claims are labelled.

## Production reality check (D1, read-only, 2026-09-28)

2 quotes (1 finalized), 1 job (cancelled test), 0 leads. **The bottleneck is volume, not tooling.** No Command Center feature beats getting more real leads, answering them fast, and closing them. Under the Cathedral Principle (Foundation → Revenue → Systems → Scale), everything below the line in the table is Systems/Scale and should wait for sustained job volume.

## What Clearview already has that the big platforms do not

- Deterministic Build Plan: quote → openings → materials → install → QC → human approval, with stale-quote detection and job snapshots. Jobber and Housecall Pro have no equivalent. **This is the differentiator. Protect it and do not rebuild commodity CRM around it.**
- Field checklists, closeout gating, evidence photos, lead journey attribution, internal AI copilot with a human-approval boundary.

## Gaps, ranked (revenue-closest first)

| # | Gap | What platforms do | Evidence | Clearview today | Build size |
|---|-----|-------------------|----------|-----------------|------------|
| 1 | **Speed-to-lead alert** (built 2026-09-28) | Instant push/SMS to the owner and an instant auto-reply | Responding within 5 min makes contact ~100× and qualification ~21× more likely than at 30 min (Oldroyd/MIT). Vendor claim: 62% conversion at 2 min vs 28% at 42 min (ServiceTitan) | Email to Mark plus a customer receipt email. No phone push | S: push notification on lead insert |
| 2 | **Quote follow-up cadence** | Automated reminders on quotes that go quiet | Vendor claim: +25% quote approval (Jobber). Case studies show 10–20 point close-rate lifts | Manual `follow_up_tasks`. Nothing fires on its own | S–M: cron creates due tasks at day 2/7/14 for unsigned quotes. Keep reminders to Mark; don't auto-message customers until reviewed |
| 3 | **Post-job review request** (built 2026-09-28) | Automatic text/email after completion | 83% of consumers asked for a review left one (BrightLocal 2026) | Closeout exists but asks for nothing. GBP has 1 review | S: button on finalized closeout that sends a Google review link. Never pre-writes review text |
| 4 | **Customer-facing quote link + deposit** | Customer views, e-signs and pays a deposit online | Window deposits are commonly 20–50% before the manufacturer order (industry forums and installer guides) | Signing happens on Mark's device only. Deposits and payments are recorded by hand | M–L: signed public token page, Stripe Checkout for the deposit, webhook into `job_payments`. Stripe connector is not authorized in this session |
| 5 | Online invoice payment | Pay-by-link on every invoice | Vendor claim: "paid 4× faster" (Jobber) | Invoices are sent. Payment is recorded manually | M: reuses #4's Stripe work |
| — | *Below this line: Systems/Scale. Wait for volume.* | | | | |
| 6 | Job costing / margin | Actual materials and labour vs quoted | — | None | M |
| 7 | Appointment reminders / "on my way" texts | Automated SMS | — | Schedule page only | M (needs SMS provider + A2P registration) |
| 8 | Online self-booking, dispatch, multi-tech routing, inventory, financing, membership plans | Standard in Housecall Pro and ServiceTitan | — | None | L. One-installer business: don't build |

## Buy-vs-build flag

Gaps 4–8 are commodity features that Jobber and Housecall Pro sell off the shelf. Before building any of them, price a subscription and ask whether Clearview could run commodity CRM there and keep only the Build Plan and field-QC system custom. Building payments/SMS in-house carries compliance cost (PCI scope via Stripe Checkout is small; SMS needs A2P 10DLC registration).

## Recommended order

1. Pressure-test lead volume first: confirm the estimate form writes leads in production (0 rows is suspicious; see HANDOFF 2026-09-28).
2. Gap 1, then 3, then 2. Each is small, uses existing tables, and sits directly on the revenue path.
3. Gap 4 only once quotes are regularly signed, which is also when the Stripe connector needs authorizing.

## Sources

- Lead response: [MIT/Oldroyd summary via Rework](https://resources.rework.com/libraries/lead-management/lead-response-time), [PipelineOn](https://pipelineon.com/blog/responding-to-leads-faster-home-service/)
- Quote follow-up: [Jobber quotes](https://www.getjobber.com/features/quotes/), [Jobber trends report](https://www.getjobber.com/home-service-trends-report/)
- Reviews: [BrightLocal LCRS 2026](https://www.brightlocal.com/research/local-consumer-review-survey/)
- Platform features: [Housecall Pro features](https://www.housecallpro.com/features/), [Jobber payments](https://www.getjobber.com/features/field-service-credit-card-processing/)
- Deposits: [Ecoline Windows](https://www.ecolinewindows.ca/window-replacement-downpayment/), [Construction Cost Accounting](https://www.constructioncostaccounting.com/post/window-door-installer-bookkeeping)
