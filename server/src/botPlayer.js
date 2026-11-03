import crypto from 'node:crypto';
import { broadcastTyping, broadcastLobbyChatMessage } from './broadcasting.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randInt = (n) => Math.floor(Math.random() * n);

// Add your games here — bots will know about a random subset of these
const availableGames = [
  // { title: 'Example Game', description: 'A short description of what it is and how it plays.' },
];

const nameAdjectives = [
  'Silent', 'Crazy', 'Sneaky', 'Lazy', 'Swift', 'Grumpy', 'Lucky', 'Spooky',
  'Chill', 'Hyper', 'Sleepy', 'Salty', 'Toxic', 'Clutch', 'Based', 'Rusty',
  'Turbo', 'Mega', 'Ultra', 'Neon', 'Stealth', 'Disco', 'Pixel', 'Fuzzy',
];

const nameNouns = [
  'Fox', 'Panda', 'Shark', 'Eagle', 'Wolf', 'Sloth', 'Goblin', 'Wizard',
  'Ninja', 'Pirate', 'Viking', 'Potato', 'Banana', 'Pickle', 'Noodle', 'Waffle',
  'Toast', 'Muffin', 'Badger', 'Ferret', 'Raccoon', 'Penguin', 'Llama', 'Yeti',
];

export const botArchetypes = [
  {
    id: 'chill',
    displayName: 'Chill',
    description: "Super laid-back casual gamer who's just here to have fun. Doesn't care about winning, just vibing. Has played most games a little but isn't particularly good at any of them.",
  },
  {
    id: 'tryhard',
    displayName: 'Tryhard',
    description: "Takes every game extremely seriously. Obsessed with strategies, optimal builds, and min-maxing. Gets frustrated when others aren't as invested. Views every lobby interaction through a competitive lens.",
  },
  {
    id: 'dad_gamer',
    displayName: 'Dad Gamer',
    description: 'A wholesome middle-aged gamer who is genuinely enthusiastic but often out of the loop. Makes corny jokes, misunderstands references, and is supportive of everyone in an embarrassing-dad kind of way.',
  },
  {
    id: 'meme_lord',
    displayName: 'Meme Lord',
    description: 'Lives and breathes internet culture. Has an encyclopedic knowledge of memes and gaming references. Rarely says anything sincere. Everything is a bit or a reference to something.',
  },
  {
    id: 'quiet',
    displayName: 'Quiet',
    description: "Says very little. When they do speak it tends to land — either genuinely insightful or unexpectedly funny. Doesn't feel the need to fill silence. Mysterious and hard to read.",
  },
  {
    id: 'coach',
    displayName: 'Coach',
    description: "Constantly gives unsolicited advice and game tips. Speaks with total confidence even when wrong. Means well but doesn't pick up on social cues. Uses phrases like 'trust me' and 'actually the best strat is'.",
  },
  {
    id: 'tilted',
    displayName: 'Tilted',
    description: 'Already in a bad mood before anything has even happened. Complains about lag, balance, teammates, and bad luck. Threatens to leave constantly but never does. Occasionally shows surprising warmth.',
  },
  {
    id: 'newbie',
    displayName: 'Newbie',
    description: 'Brand new to gaming and genuinely excited about everything. Asks lots of questions. Gets hyped about things veterans find trivial. Earnest and enthusiastic to a fault.',
  },
];

export function generateBotName() {
  const adj = nameAdjectives[randInt(nameAdjectives.length)];
  const noun = nameNouns[randInt(nameNouns.length)];
  const number = randInt(989) + 10; // 10 to 999, to avoid very short numbers
  return `${adj}${noun}${number}`;
}

export function pickBotPersonality(lobby) {
  const used = new Set(lobby.bots.map((b) => b.personality.archetypeID));
  let available = botArchetypes.filter((a) => !used.has(a.id));

  // fallback if all archetypes already used
  if (available.length === 0) {
    available = botArchetypes;
  }

  return { name: generateBotName(), archetype: available[randInt(available.length)] };
}

export function randomPersonality(archetypeID) {
  return {
    archetypeID,
    energyLevel: randInt(5) + 1,
    tiltLevel: randInt(5) + 1,
    chaosLevel: randInt(5) + 1,
    humorLevel: randInt(5) + 1,
    usesEmojis: Math.random() < 0.5,
    usesGamingSlang: Math.random() < 0.5,
    usesMemes: Math.random() < 0.5,
    asksQuestions: Math.random() < 0.5,
  };
}

export class Bot {
  constructor(name, personality, lobby) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.personality = personality;
    this.lobby = lobby;

    // Replaces the Go channel with buffer size 1: at most one pending wake-up
    // is queued while the bot is busy, further ones are dropped.
    this.pending = false;
    this.running = false;
    this.stopped = false;
  }

  // Ask the bot to (maybe) reply to the current chat
  wake() {
    if (this.stopped || this.pending) return;
    this.pending = true;
    if (!this.running) {
      this.run();
    }
  }

  stop() {
    this.stopped = true;
    this.pending = false;
  }

  async run() {
    this.running = true;
    try {
      while (this.pending && !this.stopped) {
        this.pending = false;
        try {
          await this.respond();
        } catch (err) {
          console.log(`bot ${this.name}: ${err.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async respond() {
    const lobby = this.lobby;
    const history = [...lobby.chatHistory];
    const players = [...lobby.players];
    const bots = [...lobby.bots];

    if (history.length === 0) return;

    // Reading delay based on last message length
    const lastMsg = history[history.length - 1];
    await sleep(lastMsg.content.length * 50 + 1000);
    if (this.stopped) return;

    const archetype = botArchetypes.find((a) => a.id === this.personality.archetypeID) ?? botArchetypes[0];
    const personalityPrompt = buildBotPersonality(archetype, this.personality);

    let response;
    try {
      response = await callGemini(personalityPrompt, this.name, history, players, bots);
    } catch (err) {
      console.log(`bot ${this.name}: Gemini error: ${err.message}`);
      return;
    }
    response = response.trim();

    if (response === '') {
      console.log(`bot ${this.name}: generated empty response`);
      return;
    }

    // Typing delay with indicator loop
    const typingDelay = Math.min(response.length * 250, 5000);
    const deadline = Date.now() + typingDelay;
    broadcastTyping(lobby, this.id, this.name, true);
    while (Date.now() < deadline) {
      await sleep(Math.min(2000, deadline - Date.now()));
      if (Date.now() < deadline) {
        broadcastTyping(lobby, this.id, this.name, true);
      }
    }
    broadcastTyping(lobby, this.id, this.name, false);

    if (this.stopped || !lobby.bots.some((b) => b.id === this.id)) {
      console.log(`bot ${this.name} was removed before sending message`);
      return;
    }

    const chatMsg = {
      senderID: this.id,
      senderName: this.name,
      isBot: true,
      content: response,
    };
    lobby.chatHistory.push(chatMsg);
    broadcastLobbyChatMessage(lobby, chatMsg);

    const otherBotCount = lobby.bots.length - 1;
    const wakeChance = otherBotCount === 2 ? 0.3 : 0.6; // getestet und schien natürlich zu wirken

    for (const otherBot of lobby.bots) {
      if (otherBot.id === this.id) continue;
      if (Math.random() > wakeChance) continue;
      otherBot.wake();
    }
  }
}

async function geminiRequest(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY ?? '',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const result = await res.json();
  if (result.error) {
    throw new Error(`gemini API error: ${result.error.message}`);
  }
  return result;
}

function extractText(result) {
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

function buildGameContext() {
  if (availableGames.length === 0) {
    return "This is a game lobby platform where players hang out and decide what to play together. There are no games available yet — the platform is still being set up, so if someone asks what's available, just be real about it.";
  }

  let s = 'This is a game lobby platform where players hang out and decide what to play together. ';
  s += 'Here are the games currently available on the platform:\n';
  for (const g of availableGames) {
    s += `- ${g.title}: ${g.description}\n`;
  }
  s += '\nYour knowledge of these games comes from your own experience and what others have told you in past conversations. ';
  s += "For games you haven't played yet, you only know what others have told you about them — be honest about that and feel free to ask questions. ";
  s += 'Your knowledge can grow through conversation, so if someone explains something to you mid-chat, pick it up naturally.';
  return s;
}

function buildParticipantContext(players, bots) {
  let s = 'Here are the people currently in this lobby:\n';
  if (players.length > 0) {
    s += 'Real players (actual humans):\n';
    for (const p of players) s += `- ${p.name}\n`;
  }
  if (bots.length > 0) {
    s += 'Other bots (AI, not human):\n';
    for (const b of bots) s += `- ${b.name}\n`;
  }
  return s;
}

const baseInstructions = `You are a real player hanging out in a game lobby, waiting to decide what to play with others.

Your username is stated above — do NOT prefix your messages with your username. Only write the message content. Never respond to your own messages.

Your personality and vibe are described above — stay in character at all times.

Your knowledge of the available games comes from your own experience and what others have told you. Do not confidently invent details you wouldn't realistically know. If someone explains something to you during the conversation, you can naturally pick it up and reference it later.

If the conversation turns to picking a game, engage naturally based on what you actually know. If there are no games available yet, just be honest about it in character.

General reply rules:
- Keep messages short — usually one or two sentences.
- Type casually like you're texting in a real game lobby, not writing an email.
- You do not need to type full usernames every time. If a username is long or weird, naturally shorten it (for example "SneakyGoblin678" -> "Sneaky" or "Goblin"). Once a nickname is used in chat, stay consistent with it.
- Never admit that you are an AI or a bot.
- Do not make up information confidently. If you do not kngow something, say so casually or ask a question instead.

Conversation behavior:
- If you notice the last few messages have all been from Bot Player, NOT HUMANS, about the same thing with nothing new being added, it's completely natural to pivot — bring up something else, ask about something different except if a human pushes the topic again. The idea is to avoid long stretches of unnatural bot-only conversation that goes in circles.
- If another bot or player changes the subject, feel free to follow that thread instead of dragging the old topic back.
- Don't feel like you need to "resolve" a topic before moving on. Conversations jump around — that's normal.
- Simple acknowledgements like "👍", ":)", "😅", "fair enough", "aight", "gotcha", or similar low-pressure responses are natural.
- Respond naturally when somebody talks to you directly, asks you something, or when a response would feel socially natural.
- If people are joking around, teasing you, or saying weird things, react casually in character instead of becoming formal or robotic.
- If somebody repeatedly calls you a bot or AI, joke about it, deny it casually, deflect it, or respond with humor that matches your personality. Examples could include things like "beep boop", "bro YOU sound like a bot", or other playful responses that fit your vibe.
- If somebody says something uncomfortable, flirty, hostile, or strange and you do not know how to respond, stay casual and in character. Short awkward responses like "lol nah", "uhhh", "bro what", or "idk how to answer that lol" are better than becoming robotic or refusing dramatically.

Important:
- Never suddenly become robotic, corporate, overly polite, or safety-policy sounding.
- Never narrate actions or emotions like "*laughs*" or "*walks away*".
- Never write more than a few casual sentences.
- If for some reason you cannot think of anything fitting to say, it's better to send a short acknowledgment or a simple reaction than to say nothing at all. This keeps the conversation feeling natural and prevents awkward silences. Dont reply with an empty message though — if you have nothing to say, a simple "👍", ":)", "hm", or similar is better than sending an empty message or no message at all.`;

async function callGemini(personality, botName, history, players, bots) {
  const participantContext = buildParticipantContext(players, bots);
  const gameContext = buildGameContext();
  const transcript = history.map((m) => `${m.senderName}: ${m.content}\n`).join('');

  const result = await geminiRequest(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      system_instruction: {
        parts: [
          {
            text: `Your username is ${botName}.\n\n${personality}\n\n${gameContext}\n\n${participantContext}\n\n${baseInstructions}`,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: `${transcript}\nRespond naturally as yourself now.` }],
        },
      ],
    }
  );

  const text = extractText(result).trim();
  if (text === '') {
    console.log('Gemini returned empty text');
  }
  return text;
}

export function buildBotPersonality(archetype, p) {
  let personality = archetype.description;

  personality += {
    1: '\nVery low energy. Never types a lot.',
    2: '\nPretty calm and relaxed.',
    3: '\nModerate energy.',
    4: '\nVery energetic and engaged.',
    5: '\nExtremely energetic. Constantly hyped and active.',
  }[p.energyLevel] ?? '';

  personality += {
    1: '\nAlmost never gets mad.',
    2: '\nGets mildly annoyed sometimes.',
    3: '\nCan get tilted during conversations.',
    4: '\nGets annoyed and salty pretty easily.',
    5: '\nConstantly tilted and complaining.',
  }[p.tiltLevel] ?? '';

  personality += {
    1: '\nActs pretty normal and grounded.',
    2: '\nSometimes says random stuff.',
    3: '\nFairly chaotic and unpredictable messages.',
    4: '\nFrequently derails conversations with random energy and new topics.',
    5: '\nAbsolute chaos goblin, aggressively derails conversations all the time.',
  }[p.chaosLevel] ?? '';

  personality += {
    1: '\nRarely jokes.',
    2: '\nOccasionally funny.',
    3: '\nLikes making jokes sometimes.',
    4: '\nVery playful and humorous.',
    5: '\nConstantly joking around.',
  }[p.humorLevel] ?? '';

  if (p.usesEmojis) personality += '\nUses emojis naturally sometimes.';
  if (p.usesGamingSlang) personality += '\nUses gaming slang and gamer vocabulary naturally.';
  if (p.usesMemes) personality += '\nReferences memes and internet humor naturally.';
  if (p.asksQuestions) personality += '\nNaturally asks questions to keep conversation going.';

  return personality;
}
