# CHAOS TABLE: rules

The rules engine is `shared/rules.ts`. It is deterministic: the same seed and the same actions always give the same game. Both the solo game and the game server run this same code, and the tests in `shared/rules.test.ts` check every rule below.

## The deck (108 cards)

- **Colours:** red, yellow, green and blue. Each colour also has a corner symbol (heart, sun, leaf, drop), so colour is never the only cue.
- **Number cards (per colour):**
  - one 0;
  - two each of 1 to 9.
- **Action cards (per colour):** two Skip, two Reverse and two Draw Two.
- **Wild cards:** four Wild and four Wild Draw Four.

## Setup

- Each player is dealt 7 cards.
- The top card of the remaining deck starts the discard pile. It is always a number card: any action card or wild turned up is buried back in the deck.
- The player to the dealer's left goes first. Play then moves clockwise. The dealer rotates every round.

## Your turn

You must do one of these:

1. **Play a card that matches the top card:**
   - the same colour as the current colour;
   - the same number; or
   - the same symbol (Skip on Skip, Reverse on Reverse, Draw Two on Draw Two).
2. **Play a Wild.** You can play a Wild at any time, and you choose the next colour.
3. **Play a Wild Draw Four.** This is only allowed when you hold no card of the current colour. The server enforces this. There is no challenge rule.
4. **Draw one card.** If the drawn card can be played, you may play it (and only it) or keep it and pass. If it cannot be played, your turn passes automatically.

## Card effects

- **Skip:** the next player loses their turn.
- **Reverse:** the direction of play changes. With two players it acts as a Skip.
- **Draw Two:** the next player draws 2 cards and loses their turn. There is no stacking.
- **Wild:** you choose the colour.
- **Wild Draw Four:** you choose the colour. The next player draws 4 cards and loses their turn.

## Last card and winning

- When a player is down to one card, everyone is told: the spotlight comes on and "LAST CARD!" appears. You do not have to call it, so there is no penalty for forgetting.
- The first player with no cards left wins the round. A Draw Two or Draw Four played as a final card still deals its cards.
- Results show everyone's remaining cards. Wins are counted for each seat across rematches.

## When the draw pile runs out

The discard pile, apart from its top card, is shuffled to form a new draw pile.

## House rules

The host sets these in the lobby, or you set them on the solo setup screen.

- **Draw until playable:** instead of drawing one card, you keep drawing until you get a card you can play.
- **Turn timer (off, 15 s or 30 s):** when time runs out, the server draws for you. If the drawn card can be played, it is kept and the turn passes.

## Fairness

- Clients only ever send intentions: "play card 42 as blue", "draw" or "pass".
- The host checks each one against these rules and rejects anything illegal: out of turn, a card you don't hold, or a Wild Draw Four while you hold the current colour.
- Each player is sent only their own hand. Other players' draws reach you as a count only, never as the cards.
