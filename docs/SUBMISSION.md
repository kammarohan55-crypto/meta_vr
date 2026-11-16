# Submission draft: Meta VR Start Developer Competition 2026

Draft text for the Devpost form, written from what the game does today. Edit it into the team's own voice before sending. Square brackets mark facts only the team knows.

Deadline: **18 November 2026, 12:00 PT** (19 November, 01:30 IST). Nothing can be changed after it, and the link must stay up through judging.

## Form fields

| Field | Draft |
|---|---|
| Name | AFTERHOURS: The Card Lounge |
| Tagline (140 max) | A five-minute card night in VR: pinch, push and play with friends from any seat, with nothing but your hands and eyes. |
| Track | Gaming |
| Division | [New Experience if work began on or after 24 September 2026; the repository's first commit is 14 November 2026] |
| Project link | [the hosted link, after this build is deployed to it] |
| Video link | [YouTube or Vimeo, public, under 3 minutes] |
| Team | [name, email and role for each of the three members] |
| Target launch date | [date] |

## Description (about 330 words; the form suggests 500 or fewer)

**Inspiration.** [Rewrite in your own words.] Card night is the easiest game to share and the hardest to have when your friends are in other cities. We wanted the feeling of sitting down at a table with them, from a sofa, a bed or an airplane seat, in the five minutes you actually have.

**What it does.** AFTERHOURS is a seated card game played with bare hands. You match colours and symbols to empty your hand first. Pinch a card and push it forward to play it, or point and pinch. Pinch the deck to draw. On Meta VR Glasses you look at a card and pinch. Nothing needs a controller, and nothing asks you to reach further than a hand's length: the table sets itself to your height wherever you sit.

A round takes about five minutes. Play alone against three heroes, join a Quick match with anyone online, or open a private table and share its code. Type your own name, pick your hero, and throw a rubber chicken at whoever made you draw four. Four hand-built worlds change the mood, from a snowy mountain deck to a moonlit shrine.

Every colour also carries its own suit, so the cards read without relying on colour. Effects and flashing can be turned down. The game watches its own frame rate in the headset, and asks for a lower display rate or drops shadows if the headset cannot keep up.

**How we built it.** Meta's Immersive Web SDK (WebXR) with TypeScript. One rules engine runs both solo play in the browser and online tables, which live on Cloudflare Workers; if no server answers, friends connect to each other directly. The worlds, the card faces and the effects are drawn in code, so the title appears after about 1 MB of download.

**What's next.** [Edit.] Testing with more players on real headsets, voice chat across devices, a mixed-reality mode that deals onto your real table, and new house rules.

## Video (under 3 minutes; judges may stop watching at 3:00)

The rules ask for real gameplay, led by what makes the project distinct, and allow footage from a headset or from an emulator.

| Time | Show |
|---|---|
| 0:00 to 0:10 | A hand pinches a card, pushes it forward, it lands with its effect. Title. |
| 0:10 to 0:30 | From opening the link to the first card dealt, uncut. Say "sit anywhere". |
| 0:30 to 1:10 | A turn each way: pinch and push, point and pinch, draw from the deck, a Wild and its colour, a Draw Four landing. |
| 1:10 to 1:35 | The glasses view: look at a card, pinch. Everything a turn needs stays in view. |
| 1:35 to 2:15 | Friends: Quick match or a table code, two players, a toy thrown, a reaction, "Get even". |
| 2:15 to 2:40 | The four worlds; suits on the cards; reduced effects. |
| 2:40 to 2:50 | Name and link. |

## Before pressing Submit

- [ ] This build is deployed to the hosted link, and the link opens in a private browser window.
- [ ] The link was opened on a real Quest: enter VR, play one solo round with hands only, pause and resume. Note the frame rate if you can (the game logs it: `chaos.fpsLog` over remote debugging).
- [ ] Whoever submits is a Meta VR Start member.
- [ ] The video is public and under 3 minutes.
- [ ] If the form asks about AI tools used in development, answer accurately: AI coding assistants were used on this project.
- [ ] Third-party assets are listed in `ASSET_CREDITS.md`; nothing in the build shows a real person or another product's artwork.
