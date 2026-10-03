---
title: Privacy policy
description: What Clearview Windows collects when you use this website, who processes it, and how to have it deleted.
updated: 2026-10-03
order: 1
summary: This site uses Google Analytics and Cloudflare Web Analytics to see which pages get read, which sets a cookie and assigns you a random ID. It also runs a Meta (Facebook/Instagram) advertising pixel, which sets its own cookie and tells Meta when a page is viewed and when the estimate form is submitted, so we can measure our own Facebook/Instagram ads. If you submit the estimate form, we also keep your submission and the pages you viewed beforehand in our own database, tied to your name — never sold, shared, or used to build a mailing list. The /ask consultant sends what you type to an AI service (Groq or Google) to write its answers, analyzes any photo you attach on Cloudflare, and keeps no photos. We keep each question and answer for 30 days, with phone numbers, email addresses, street addresses and similar details removed, so we can see what people ask, and then delete them. If you ask it for a call back, that request is handled like an estimate request.
---

Clearview Windows, operated by Clearview Windows & Trim LLC ("Clearview", "we",
"us"), runs windowsbyclearview.com.
This policy describes what the website actually does with your information. It
is written against the code that runs the site rather than from a template, so
where it says we do not collect something, we do not collect it.

## What we collect

**From the estimate form.** If you submit the form at
[/estimate](/estimate), we receive the fields you filled in:

- Your name (required)
- A phone number (required)
- Your city (required)
- An email address (optional)
- Whether you are a homeowner or a builder / GC
- Any project notes you write

**From a call-back request on /ask.** The website consultant at [/ask](/ask)
can also send us a call-back request. It asks for the same fields (name,
phone number, city, and an optional email), plus a notes box that is filled
in with the project details you chose and the questions you typed to the
consultant. You can edit or clear that text before sending, and nothing is
sent until you press the button. We store and handle it the same way as an
estimate request, and it is marked as coming from the consultant.

Nothing else on the site asks you for personal information.

**Automatically, as a consequence of hosting.** The site is served by
Cloudflare Pages. Like any web host, Cloudflare's edge network processes your
IP address and browser user-agent in order to deliver the page and to block
abusive traffic. We do not receive, store, or analyze those logs ourselves.

**Traffic counting.** The site uses Google Analytics and Cloudflare Web
Analytics side by side, and they work differently:

- **Cloudflare Web Analytics** counts page views. It records the page
  visited, the referring site, your browser and operating system, your
  country, and how quickly the page loaded. It uses no cookies, sets no
  identifier on your device, and does not fingerprint you — it cannot follow
  you between visits, and we cannot tell that two page views came from the
  same person.
- **Google Analytics (GA4)**, run through Google Tag Manager, also records
  page views, plus which pages you came from and left through in one visit.
  Unlike Cloudflare's tool, it sets a cookie in your browser and assigns you a
  randomly generated ID, so it can tell that the same browser viewed several
  pages in one visit or came back later. We have not turned on Google Signals
  or any advertising-personalization feature for this property, so Google
  Analytics is not, to our knowledge, linking your visits here to a Google
  account or using them for ad targeting on this site. Your data is still
  processed on Google's servers under Google's own privacy policy, which we do
  not control.

  We also send Google Analytics a small number of aggregate event counts: when
  someone clicks a phone number, clicks a link to the estimate form, reads at
  least three-quarters of the way down a guide article, or submits the
  estimate form. These only count how often each thing happens across all
  visitors — the same cookie-based ID as above, no new personal information.

We use both to see which pages are worth writing and which are not. That is
the whole purpose.

**Advertising.** The site also runs a Meta (Facebook/Instagram) pixel,
delivered through the same Google Tag Manager. Unlike the analytics tools
above, this one exists specifically to measure our own Facebook and Instagram
ads — it is advertising technology, not neutral analytics. It sets its own
cookie in your browser, distinct from Google's, and tells Meta when a page is
viewed and, separately, when the estimate form is submitted (as a "Lead"
signal, not the contents of what you typed). Meta processes this under its
own privacy policy, which we do not control. If you arrived here from a Meta
ad, or if you are logged into Facebook or Instagram in the same browser, Meta
may be able to connect this visit to your account; if you use ad blockers or
tracking protection, some or all of this pixel will not load at all.

**We do not collect** heatmaps, session recordings, mouse or scroll tracking,
or location beyond the city you type in.

## The website consultant (/ask)

The consultant at [/ask](/ask) answers questions about windows using an AI
model. Here is what happens to what you type.

- **Your messages.** Each message you send is sent to an AI service to write
  the reply, along with the project details you pick and your last several
  messages and replies in the same chat. We use Groq, or Google (Gemini) if
  Groq is not available. Google also receives your message so it can be
  matched against our guides. These companies process it under their own
  privacy policies, which we do not control.
- **Photos.** If you attach a photo, your browser shrinks it and a vision
  model run by Cloudflare (Workers AI) describes what is visible. We do not
  keep the photo. A short text description of it goes to the AI service along
  with your message.
- **Web searches.** For general questions the consultant may search the web
  through DuckDuckGo, using a search phrase the AI writes from your question.
  DuckDuckGo sees that phrase and the address of our server, not yours.
- **What we keep.** We do not keep your photos, and we do not link anything
  you type in the chat to your name, your address or any ID for your browser.
  For each message we keep the time, which AI service answered, which tools it
  used, which guides it drew on, whether it could answer, and the text of your
  question and the reply, so we can see what people ask and where the
  consultant falls short. Before that text is saved, phone numbers, email
  addresses, web links, street addresses, ZIP codes, long strings of digits
  and a name you introduce yourself with ("my name is…") are replaced with a
  placeholder. This is a best effort and will not catch everything, so please
  do not put personal details in the chat. Only the owners of the business can
  read the saved text, in our internal tools. It is deleted 30 days after the
  message. Our nightly database backup keeps the counts and the other details
  above but leaves this text out, so deleting it after 30 days removes it
  everywhere. Because the saved text is not tied to you, we cannot look up a
  particular conversation if you ask us to delete it; it will be gone within
  30 days. The chat itself lives only on the page in your browser; reloading
  it or choosing New chat clears it.
- **Counting hand-offs.** When you go from the consultant to the estimate
  form, tap the call button, or open the call-back form, we add one to a count
  in our database. It records only which of those it was and the time,
  nothing about you. These counts can also be sent to Google Analytics as
  aggregate events, like the ones described above.

Please do not type your phone number or address into the chat. Use the
call-back form or the [estimate form](/estimate) for that, so it goes only to
us.

## If you request an estimate: your visit history

When you submit the estimate form or a call-back request from /ask, your browser also sends us a short record
of how you found the site and which pages you looked at first. Specifically:

- **A random ID for your browser**, generated the first time you visit and
  stored only in your browser (see "Cookies and local storage" below) — not a
  cookie, and not shared with Google Analytics or any other service.
- **Your first-touch details**: the first page you landed on, the site that
  referred you (if any), and any campaign parameters present in that first
  URL.
- **The pages you visited in this browsing session** (up to 25), each with
  its path, title, and the time you viewed it.

This never leaves your browser unless you submit the estimate form or a
call-back request — there is no background tracking beacon, and nothing is
sent to us if you just browse the site and leave. If you do submit one, this visit history is stored
alongside your name, phone number, and the other fields you typed, in the
database described below, so the person who calls you back has context on
what you were looking at. It is never used for advertising, never sold or
shared, and never turned into a mailing list.

## Cookies and local storage

**Google Analytics sets a small number of first-party cookies** (named `_ga`
and `_ga_*`) so it can recognize a returning visit. **The Meta pixel** sets its
own cookies (named `_fbp`, and `_fbc` if you arrived from a Meta ad) so Meta
can do the same for its own measurement. Cloudflare Web Analytics sets none.

The cost calculator also stores one item in your browser's `sessionStorage` — the
project scope you built, under the key `clearview:scope` — so that the estimate
form can pre-fill your notes if you choose to continue. It stays in your
browser, is never transmitted to us, and your browser discards it when you
close the tab.

The site also uses a few more items in your browser's `localStorage` and
`sessionStorage` to build the visit history described above: `clearview:vid`
(the random browser ID, kept until you clear your browser data),
`clearview:first_touch` (how you first arrived), and `clearview:visits` (the
pages viewed in your current browsing session, cleared when you close the
tab). None of these are cookies, and none are sent anywhere in the
background — they only reach us if you submit the estimate form or a
call-back request.

## Requests your browser makes to other companies

Very few. Every asset this site needs — the stylesheet, the typeface, the
photographs, the icons — is served from this domain. There is no font CDN.

Three exceptions, all described above: **Cloudflare Web Analytics**, which
loads from `static.cloudflareinsights.com` (Cloudflare already handles every
request to this site as its host, so this does not introduce a company that
was not already in the path); **Google Analytics**, run through **Google Tag
Manager**, which loads from `googletagmanager.com` and sends visit data to
Google's servers; and the **Meta pixel**, also delivered through Google Tag
Manager, which loads from `connect.facebook.net` and sends page-view and
lead-submission signals to `facebook.com`.

## Who else sees your estimate request

Your submitted fields — name, phone, city, and the rest, whether they come
from the estimate form or the call-back form on /ask — are handled by exactly
three companies, each doing one job:

| Company | What they do | What they see |
| --- | --- | --- |
| Cloudflare | Runs the function that receives the form and stores the record described below | The submitted fields and visit history, in transit and at rest |
| Resend | Delivers the two emails | The submitted fields, in the message body |
| Google Workspace | Hosts the business mailbox the lead arrives in | The submitted fields, in the message |

Separately, **Meta** — via the advertising pixel described above — is told
that a "Lead" event happened, so we can measure ad performance. It does not
receive the fields you typed; only its own advertising cookie and the fact
that a submission occurred.

If you gave an email address, Resend also sends you a short confirmation that
we received the request.

We also get a notification on our phone when a request arrives. It goes
through ntfy, a free notification service, and says only that someone asked
for an estimate. It contains none of your information.

If we install windows for you, once the job is finished and you have signed
off on it, we may ask one time for a Google review. We ask either by email,
sent through Resend, or by a text from our own phone. We ask once per job and
never follow up on it.

If we send you a link to review and sign your quote online, the signing page
records the name you type, your drawn signature, when you signed, and your
browser's user-agent string (the browser and device type it reports), as a
record of the signature. The link itself is private: it works only for your
quote, stops working once you sign or we replace it, and expires after 30 days.

We do not use a customer relationship manager or a marketing platform, and
nothing here is used to build a mailing list. We do keep your submission — the
fields you typed and the visit history above — in a small database on
Cloudflare that only we can browse, so we have that context in front of us
when we call or email you back. That database record, and the email in
our inbox, are the only stored records of your submission.

## What we do with it

We use your information for one purpose: to contact you about the window work
you asked about, and to carry out that work if you hire us.

**We do not sell your personal information. We do not share it for
cross-context behavioral advertising. We do not add you to a mailing list, a
newsletter, or an automated follow-up sequence.** We have never done any of
these things and this site is not built to.

## Calls and texts

By giving us your phone number you are asking us to call you back about your
project. If you also want text messages, say so — we will not text you
otherwise. Either way, tell us to stop and we will stop.

## How long we keep it

Your request lives as an email in the business mailbox we read, and as a
record in the database described above. We keep both for active and recent
jobs so we can honour what we agreed to. If you ask us to delete your
information and you are not a current customer with an open job, we will
delete the correspondence and the database record.

The records described under the website consultant, such as the time and kind
of each answer and the hand-off counts, contain nothing about you personally,
so we keep them for as long as they are useful.

Washington law requires a contractor to retain certain records relating to work
actually performed. Where that applies, we keep only what the law requires and
only for as long as it requires.

## Your choices

Whatever state you live in, you can ask us to:

- tell you what personal information of yours we hold,
- correct it,
- delete it, or
- stop contacting you.

Email [owner@windowsbyclearveiw.com](mailto:owner@windowsbyclearveiw.com) or call
(564) 208-0801. We will not charge you, and we will not treat you differently
for asking. There is nothing to opt out of regarding sale or targeted
advertising, because we do neither.

## Children

This site is for people arranging work on a building. It is not directed at
children, and we do not knowingly collect information from anyone under 16. If
you believe a child has sent us information, contact us and we will delete it.

## Security

Traffic to this site is encrypted in transit. Access to the mailbox holding your
request is limited to us. No method of transmission or storage is completely
secure, and we do not claim otherwise.

## Changes

If this policy changes, the date at the top of this page changes with it.
Material changes will be reflected here before they take effect.

## Contact

- Clearview Windows & Trim LLC, Vancouver, Washington
- [owner@windowsbyclearveiw.com](mailto:owner@windowsbyclearveiw.com)
- (564) 208-0801
