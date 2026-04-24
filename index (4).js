/* InstaChar v1.0.0 — Character Instagram for SillyTavern */

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "Instachar";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const VERSION = "1.0.0";

const DEFAULT_SETTINGS = {
    iconVisible: true,
    autoPost: true,
    ambientEnabled: true,
    npcDetection: true,
    postChance: 0.5,
    artStyle: "anime",
    iconPos: null,
    // Per-chat data keyed by chatId
    chats: {},
    // Global user profile (shared across chats)
    userProfile: {
        username: "",
        displayName: "",
        bio: "",
        avatar: "",
    },
};

function defaultChatData() {
    return {
        posts: [],
        dms: {},
        charProfiles: {},
        unreadCount: 0,
        followers: {}, // charName -> boolean
        currentTab: "feed",
        selectedProfile: null,
    };
}

// ---------- Logging ----------
const debugLog = [];
function log(msg, isError) {
    const ts = new Date().toLocaleTimeString();
    const line = "[" + ts + "] " + (isError ? "ERR " : "OK  ") + msg;
    debugLog.push(line);
    if (debugLog.length > 60) debugLog.shift();
    if (isError) console.error("[InstaChar] " + msg);
    else console.log("[InstaChar] " + msg);
    const $dbg = $("#instachar-debug-log");
    if ($dbg.length) $dbg.text(debugLog.slice(-12).join("\n"));
}

// ---------- Settings ----------
function getSettings() {
    try {
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }
        const s = extension_settings[extensionName];
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
            if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k]));
        }
        if (!s.chats) s.chats = {};
        if (!s.userProfile) s.userProfile = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.userProfile));
        return s;
    } catch (e) {
        log("getSettings err: " + e.message, true);
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
}

function save() {
    try { saveSettingsDebounced(); } catch (e) { log("save err: " + e.message, true); }
}

// ---------- Chat context ----------
function getCurrentChatId() {
    try {
        const ctx = getContext();
        if (ctx.chatId) return "chat_" + ctx.chatId;
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            const ch = ctx.characters[ctx.characterId];
            if (ch && ch.avatar) return "char_" + ch.avatar;
        }
        if (ctx.groupId) return "group_" + ctx.groupId;
    } catch (e) {}
    return "default";
}

function getChatData() {
    const s = getSettings();
    const id = getCurrentChatId();
    if (!s.chats[id]) s.chats[id] = defaultChatData();
    const cd = s.chats[id];
    // Backfill missing fields
    const def = defaultChatData();
    for (const k of Object.keys(def)) {
        if (cd[k] === undefined) cd[k] = def[k];
    }
    return cd;
}

function getUserName() {
    try {
        const ctx = getContext();
        return (ctx && ctx.name1) || "You";
    } catch { return "You"; }
}

function getActiveCharacterName() {
    try {
        const ctx = getContext();
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            return (ctx.characters[ctx.characterId] && ctx.characters[ctx.characterId].name) || null;
        }
    } catch {}
    return null;
}

function getActiveCharacterCard() {
    try {
        const ctx = getContext();
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            return ctx.characters[ctx.characterId] || null;
        }
    } catch {}
    return null;
}

// ---------- Utility ----------
function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return diff + " วิ";
    if (diff < 3600) return Math.floor(diff / 60) + " น.";
    if (diff < 86400) return Math.floor(diff / 3600) + " ชม.";
    return Math.floor(diff / 86400) + " วัน";
}

function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
}

function defaultAvatar(name) {
    const initial = (name || "?").charAt(0).toUpperCase();
    const colors = ["#e91e63","#9c27b0","#3f51b5","#00bcd4","#4caf50","#ff9800","#f44336","#673ab7"];
    const color = colors[(name || "").length % colors.length];
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><rect fill='" + color + "' width='80' height='80'/><text x='40' y='52' font-size='36' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='bold'>" + initial + "</text></svg>";
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

function sanitizeUsername(name) {
    if (!name) return "user_" + Math.floor(Math.random() * 9999);
    // Keep letters, numbers, underscore; strip everything else
    const cleaned = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (cleaned.length === 0) return "user_" + Math.floor(Math.random() * 9999);
    return cleaned.slice(0, 20);
}

function makeImageUrl(prompt, seed) {
    const s = getSettings();
    let stylePrefix = "";
    if (s.artStyle === "anime") stylePrefix = "anime manhwa illustration, ";
    else if (s.artStyle === "realistic") stylePrefix = "realistic photo, ";
    else if (s.artStyle === "aesthetic") stylePrefix = "aesthetic moody, ";
    else if (s.artStyle === "minimal") stylePrefix = "minimal clean composition, ";
    const p = encodeURIComponent(stylePrefix + (prompt || "aesthetic photo"));
    return "https://image.pollinations.ai/prompt/" + p + "?width=768&height=768&nologo=true&model=flux&seed=" + (seed || Math.floor(Math.random() * 99999));
}

function getCharacterAvatar(charName, card) {
    try {
        if (card && card.avatar && card.avatar !== "none") return "/characters/" + card.avatar;
        const ctx = getContext();
        const ch = ctx.characters.find(c => c.name === charName);
        if (ch && ch.avatar && ch.avatar !== "none") return "/characters/" + ch.avatar;
    } catch {}
    return defaultAvatar(charName);
}

// ---------- Character Profile ----------
function ensureCharProfile(charName, opts) {
    if (!charName) return null;
    opts = opts || {};
    const cd = getChatData();
    if (!cd.charProfiles[charName]) {
        let bio = opts.bio || "";
        let avatar = opts.avatar;
        let personality = "";
        if (!opts.isNpc) {
            // It's the main bot — pull from card
            const card = getActiveCharacterCard();
            if (card) {
                if (!bio) bio = (card.description || "").slice(0, 150);
                if (!avatar) avatar = getCharacterAvatar(charName, card);
                personality = (card.description || "") + " " + (card.personality || "");
            }
        }
        cd.charProfiles[charName] = {
            username: sanitizeUsername(charName) + "_" + Math.floor(Math.random() * 99),
            displayName: charName,
            bio: bio,
            avatar: avatar || defaultAvatar(charName),
            personality: personality.slice(0, 500),
            isNpc: !!opts.isNpc,
            followers: Math.floor(Math.random() * 5000) + 100,
            following: Math.floor(Math.random() * 500) + 50,
            postCount: 0,
            userFollowing: false,
            followsUser: Math.random() < 0.3, // some chars follow user by default
            createdAt: Date.now(),
        };
        save();
        log("Created profile: " + charName + (opts.isNpc ? " [NPC]" : " [main]"));
    }
    return cd.charProfiles[charName];
}

// ---------- LLM ----------
async function callLLM(prompt, systemPrompt) {
    let ctx = null;
    try {
        if (typeof window !== "undefined" && window.SillyTavern && typeof window.SillyTavern.getContext === "function") {
            ctx = window.SillyTavern.getContext();
        }
    } catch {}
    if (!ctx) { try { ctx = getContext(); } catch {} }
    if (!ctx) throw new Error("No context");

    const sysPrompt = systemPrompt || "You are a data assistant. Respond with valid JSON only. No markdown fences. No explanations. No character card persona — this is a separate task from the main roleplay.";

    if (typeof ctx.generateRaw === "function") {
        try {
            const r = await ctx.generateRaw({ systemPrompt: sysPrompt, prompt: prompt });
            if (r && String(r).trim() !== "") return r;
        } catch (e) { log("generateRaw: " + e.message, true); }
    }
    if (typeof ctx.generateQuietPrompt === "function") {
        try {
            const r = await ctx.generateQuietPrompt({ quietPrompt: prompt });
            if (r && String(r).trim() !== "") return r;
        } catch {
            try {
                const r = await ctx.generateQuietPrompt(prompt, false, false);
                if (r && String(r).trim() !== "") return r;
            } catch {}
        }
    }
    throw new Error("No LLM function available");
}

function parseJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const first = t.indexOf("{");
    const firstArr = t.indexOf("[");
    let start = -1;
    if (first >= 0 && (firstArr < 0 || first < firstArr)) start = first;
    else if (firstArr >= 0) start = firstArr;
    if (start < 0) return null;
    t = t.slice(start);
    try { return JSON.parse(t); }
    catch {
        for (let i = t.length - 1; i > 0; i--) {
            if (t[i] === "}" || t[i] === "]") {
                try { return JSON.parse(t.slice(0, i + 1)); } catch {}
            }
        }
        return null;
    }
}

// ---------- Core generation ----------
// The MOST IMPORTANT instruction for IG persona
const IG_PERSONA_RULE = `IMPORTANT: Instagram persona is POLITE and PUBLIC — characters who use rough/crude language (กู/มึง/เหี้ย/etc.) in private RP still use formal/polite tone on their PUBLIC Instagram. Use polite pronouns (เรา/เขา/ตัวเอง/ฉัน) and clean language appropriate for social media. The character's personality comes through via mood, topic, and style — NOT profanity.`;

async function maybeGeneratePost(charName, messageText) {
    const s = getSettings();
    if (!s.autoPost) return;
    ensureCharProfile(charName);
    const cd = getChatData();
    const profile = cd.charProfiles[charName];

    const personalityHint = profile.personality
        ? `\nCharacter personality: "${profile.personality.slice(0, 300)}"`
        : "";

    const prompt = `[System: Instagram Post Decision]
Character: "${charName}"${personalityHint}
Scene: "${messageText.slice(0, 600)}"
Art style: ${s.artStyle}

Decide if ${charName} would post on IG now. Consider:
- Is this moment post-worthy? (aesthetic, emotional, interesting)
- Does the character seem like someone who posts often?
- NOT every scene gets posted — be selective

${IG_PERSONA_RULE}

If YES: {"post": true, "caption": "short thai caption matching character mood (polite tone, no profanity)", "imagePrompt": "detailed english image prompt describing the visual scene — do NOT describe the character doing selfie unless appropriate", "hashtags": ["#tag1"], "mood": "happy|sad|flirty|chill|excited|moody|proud|angry|aesthetic"}
If NO: {"post": false}

JSON only.`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !data.post) return;
        await createCharPost(charName, data, messageText);
    } catch (e) {
        log("Post gen failed: " + e.message, true);
    }
}

async function createCharPost(charName, data, sceneContext) {
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    const likes = Math.max(5, Math.floor((profile.followers || 1000) * (0.3 + Math.random() * 1.4) / 10));

    const post = {
        id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
        author: charName,
        authorUsername: profile.username,
        authorAvatar: profile.avatar,
        caption: data.caption || "",
        hashtags: data.hashtags || [],
        image: makeImageUrl(data.imagePrompt, Date.now()),
        imagePrompt: data.imagePrompt,
        mood: data.mood,
        timestamp: Date.now(),
        likes: likes,
        userLiked: false,
        comments: [],
        userComments: [],
    };

    // Generate comments in background (non-blocking)
    generateComments(charName, post, sceneContext || "").then(comments => {
        post.comments = comments;
        save();
        if (isPanelOpen()) renderCurrentTab();
    }).catch(() => {});

    profile.postCount = (profile.postCount || 0) + 1;
    cd.posts.push(post);
    cd.unreadCount = (cd.unreadCount || 0) + 1;
    save();
    flashIcon();
    if (isPanelOpen() && cd.currentTab === "feed") renderCurrentTab();
    log(charName + " posted");
}

async function generateComments(authorName, post, sceneContext) {
    const cd = getChatData();
    const userName = getUserName();
    const otherChars = Object.keys(cd.charProfiles).filter(n => n !== authorName).slice(0, 10);

    const prompt = `[System: IG Comments]
Character "${authorName}" posted: "${post.caption}" (mood: ${post.mood})

Generate 2-4 realistic Thai IG comments on this post. Mix of:
- Followers/strangers reacting
${otherChars.length > 0 ? '- These known characters (if relevant): ' + otherChars.join(", ") : ""}

NOT from "${userName}" or "${authorName}".

${IG_PERSONA_RULE}

JSON array only: [{"username":"name","text":"short thai comment"}]`;

    try {
        const response = await callLLM(prompt);
        const arr = parseJson(response);
        if (!Array.isArray(arr)) return [];
        return arr.slice(0, 5).map(c => ({
            username: c.username || "user_" + Math.floor(Math.random() * 999),
            text: c.text || "",
            timestamp: Date.now(),
        }));
    } catch {
        return [];
    }
}

async function generateCharReaction(charName, userPost) {
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    const personalityHint = profile.personality ? `\nCharacter: "${profile.personality.slice(0, 200)}"` : "";

    const prompt = `[System: IG Reaction]
Character: "${charName}"${personalityHint}
User posted: "${userPost.caption}" (image desc: "${userPost.imagePrompt || 'photo'}")

Would ${charName} like this? Would they comment?

${IG_PERSONA_RULE}

JSON only: {"like": true|false, "comment": "polite thai comment or null"}`;

    try {
        const response = await callLLM(prompt);
        return parseJson(response) || { like: false, comment: null };
    } catch {
        return { like: Math.random() < 0.5, comment: null };
    }
}

async function generateDMReply(charName) {
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    const thread = cd.dms[charName] || [];
    const recent = thread.slice(-8).map(m => (m.from === "user" ? getUserName() : charName) + ": " + m.text).join("\n");
    const personalityHint = profile.personality ? `\nCharacter personality: "${profile.personality.slice(0, 300)}"` : "";

    const prompt = `[System: IG DM]
You are "${charName}" chatting privately on Instagram DM with ${getUserName()}.${personalityHint}

Recent DM:
${recent}

Reply as ${charName} in Thai, 1-2 sentences, casual IG DM style.

${IG_PERSONA_RULE}
(DMs can be slightly more casual than posts, but still no heavy profanity since IG platform)

Just the message text. No JSON, no prefix.`;

    try {
        const response = await callLLM(prompt, "You are a character in roleplay DM. Reply in Thai. " + IG_PERSONA_RULE);
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 500);
        if (!reply) return;
        cd.dms[charName] = cd.dms[charName] || [];
        cd.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        cd.unreadCount = (cd.unreadCount || 0) + 1;
        save();
        flashIcon();
    } catch (e) {
        log("DM reply failed: " + e.message, true);
    }
}

// ---------- NPC Detection ----------
async function detectNPCs(messageText) {
    const s = getSettings();
    if (!s.npcDetection) return;
    const cd = getChatData();
    const activeChar = getActiveCharacterName();
    const existingNames = Object.keys(cd.charProfiles);

    const prompt = `[System: NPC Detector]
Scene text: "${messageText.slice(0, 800)}"

Active main character: "${activeChar || 'unknown'}"
Already tracked: ${existingNames.length > 0 ? existingNames.join(", ") : "(none)"}

Identify any NEW named NPCs/side characters in the scene (NOT the main character, NOT the user "${getUserName()}", NOT already tracked).

For each new NPC, provide their name and brief personality inferred from the scene.

JSON only: {"npcs": [{"name": "FullName", "bio": "short thai bio 1-2 sentences"}]}
If none: {"npcs": []}`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !Array.isArray(data.npcs)) return;
        for (const npc of data.npcs) {
            if (!npc.name || typeof npc.name !== "string") continue;
            if (npc.name === activeChar) continue;
            if (npc.name.toLowerCase() === getUserName().toLowerCase()) continue;
            if (cd.charProfiles[npc.name]) continue;
            ensureCharProfile(npc.name, { isNpc: true, bio: npc.bio || "" });
            // NPC may post immediately (excited debut)
            if (Math.random() < 0.4) {
                setTimeout(() => {
                    maybeGenerateNpcIntroPost(npc.name, messageText).catch(() => {});
                }, 1500 + Math.random() * 3000);
            }
        }
    } catch (e) {
        log("NPC detect failed: " + e.message, true);
    }
}

async function maybeGenerateNpcIntroPost(charName, sceneContext) {
    const s = getSettings();
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    if (!profile) return;

    const prompt = `[System: IG New NPC Post]
NPC "${charName}" (bio: "${profile.bio}") just appeared in this scene: "${sceneContext.slice(0, 500)}"

Generate an IG post from their POV. Art style: ${s.artStyle}.

${IG_PERSONA_RULE}

JSON only: {"caption":"short thai caption","imagePrompt":"english scene description","hashtags":["#tag"],"mood":"happy|chill|moody|aesthetic"}`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !data.caption) return;
        await createCharPost(charName, data, sceneContext);
    } catch {}
}

// ---------- Ambient Activity ----------
let ambientTimer = null;

async function runAmbientActivity() {
    const s = getSettings();
    if (!s.ambientEnabled) return;
    const cd = getChatData();
    const charNames = Object.keys(cd.charProfiles);
    if (charNames.length === 0) return;

    const charName = charNames[Math.floor(Math.random() * charNames.length)];
    const userPosts = cd.posts.filter(p => p.isUserPost).slice(-5);
    const roll = Math.random();

    try {
        if (roll < 0.35 && userPosts.length > 0) {
            // Comment on user post
            const target = userPosts[Math.floor(Math.random() * userPosts.length)];
            // Skip if char already commented recently
            const recentlyCommented = (target.comments || []).some(c =>
                c.username === cd.charProfiles[charName].username &&
                (Date.now() - c.timestamp) < 3600000
            );
            if (recentlyCommented) return;

            const reaction = await generateCharReaction(charName, target);
            if (reaction && reaction.comment) {
                target.comments = target.comments || [];
                target.comments.push({
                    username: cd.charProfiles[charName].username,
                    text: reaction.comment,
                    timestamp: Date.now(),
                });
                if (reaction.like) target.likes += 1;
                cd.unreadCount = (cd.unreadCount || 0) + 1;
                save();
                flashIcon();
                if (isPanelOpen()) renderCurrentTab();
                log("Ambient: " + charName + " commented");
            }
        } else if (roll < 0.55 && userPosts.length > 0) {
            const target = userPosts[Math.floor(Math.random() * userPosts.length)];
            target.likes += 1;
            save();
            if (isPanelOpen()) renderCurrentTab();
        } else if (roll < 0.85) {
            await generateAmbientDM(charName);
        } else {
            await generateAmbientPost(charName);
        }
    } catch (e) {
        log("Ambient err: " + e.message, true);
    }
}

async function generateAmbientDM(charName) {
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    const userName = getUserName();
    const thread = cd.dms[charName] || [];
    const recentThread = thread.slice(-4).map(m => (m.from === "user" ? userName : charName) + ": " + m.text).join("\n");
    const personalityHint = profile.personality ? `\nPersonality: "${profile.personality.slice(0, 200)}"` : "";

    const prompt = `[System: IG Ambient DM]
"${charName}" decides to randomly DM ${userName}.${personalityHint}

Previous DMs:
${recentThread || "(none)"}

Generate ONE short casual Thai DM (1-2 sentences). Check-in, random thought, or share something. Match their personality.

${IG_PERSONA_RULE}

Just the message text. No JSON, no prefix.`;

    try {
        const response = await callLLM(prompt, IG_PERSONA_RULE + " Reply in Thai naturally as the character.");
        const reply = (response || "").trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].slice(0, 300);
        if (!reply) return;
        cd.dms[charName] = cd.dms[charName] || [];
        cd.dms[charName].push({ from: "char", text: reply, timestamp: Date.now() });
        cd.unreadCount = (cd.unreadCount || 0) + 1;
        save();
        flashIcon();
        if (isPanelOpen()) renderCurrentTab();
        log("Ambient DM: " + charName);
    } catch (e) {
        log("Ambient DM err: " + e.message, true);
    }
}

async function generateAmbientPost(charName) {
    const s = getSettings();
    const cd = getChatData();
    const profile = cd.charProfiles[charName];
    const personalityHint = profile.personality ? `\nPersonality: "${profile.personality.slice(0, 200)}"` : "";

    const prompt = `[System: IG Random Post]
"${charName}" posts a random slice-of-life moment.${personalityHint}
Art style: ${s.artStyle}

${IG_PERSONA_RULE}

JSON only: {"caption":"short thai","imagePrompt":"english scene","hashtags":["#tag"],"mood":"happy|chill|moody|aesthetic"}`;

    try {
        const response = await callLLM(prompt);
        const data = parseJson(response);
        if (!data || !data.caption) return;
        await createCharPost(charName, data, "");
    } catch {}
}

function startAmbientTimer() {
    stopAmbientTimer();
    const scheduleNext = () => {
        const s = getSettings();
        if (!s.ambientEnabled) return;
        const delay = 90000 + Math.random() * 180000; // 1.5-4.5 min
        ambientTimer = setTimeout(async () => {
            if (getSettings().ambientEnabled) {
                await runAmbientActivity();
                scheduleNext();
            }
        }, delay);
    };
    scheduleNext();
    log("Ambient timer started");
}

function stopAmbientTimer() {
    if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; }
}

// ---------- Shadow DOM ----------
let shadowHost = null;
let shadowRoot = null;

function buildShadowHost() {
    const existing = document.getElementById("instachar-shadow-host");
    if (existing) existing.remove();
    shadowHost = document.createElement("div");
    shadowHost.id = "instachar-shadow-host";
    shadowHost.setAttribute("style", "position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;z-index:2147483646 !important;pointer-events:none !important;margin:0 !important;padding:0 !important;border:0 !important;");
    document.documentElement.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: "open" });
    return shadowRoot;
}

// Cute rounded Instagram SVG icon
const IG_SVG = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <radialGradient id="ig-grad" cx="0.3" cy="1" r="1.2">
            <stop offset="0" stop-color="#FFDD55"/>
            <stop offset="0.3" stop-color="#FF6E3C"/>
            <stop offset="0.6" stop-color="#DC2743"/>
            <stop offset="0.85" stop-color="#BC1888"/>
            <stop offset="1" stop-color="#5851DB"/>
        </radialGradient>
    </defs>
    <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#ig-grad)"/>
    <circle cx="20" cy="20" r="8" fill="none" stroke="white" stroke-width="2.5"/>
    <circle cx="29" cy="11" r="2" fill="white"/>
</svg>`;

const SHADOW_CSS = `
:host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", sans-serif; }
* { box-sizing: border-box; }

/* Floating icon */
.floater {
    position: fixed;
    right: 16px;
    top: 150px;
    width: 56px;
    height: 56px;
    border-radius: 16px;
    background: #fff;
    padding: 3px;
    box-shadow: 0 8px 24px rgba(220, 39, 67, 0.45), 0 3px 8px rgba(75, 21, 40, 0.15);
    cursor: pointer;
    pointer-events: auto;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    animation: insta-entry 0.6s ease-out, insta-idle 3.5s ease-in-out 0.6s infinite;
    overflow: hidden;
}
.floater.hidden { display: none; }
.floater.pressed { transform: scale(0.92); transition: transform 0.1s; }
.floater.flash { background: red !important; transform: scale(1.5) !important; }
.floater svg { width: 100%; height: 100%; display: block; border-radius: 12px; }
@keyframes insta-entry { 0% { opacity: 0; transform: scale(0) rotate(-180deg); } 60% { transform: scale(1.15) rotate(10deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes insta-idle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.badge {
    position: absolute;
    top: -4px; right: -4px;
    min-width: 20px; height: 20px;
    padding: 0 5px;
    background: #ff2d55;
    color: white;
    font-size: 11px;
    font-weight: 700;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #fff;
}
.badge.hidden { display: none; }

/* Panel */
.panel {
    position: fixed;
    pointer-events: auto;
    background: #000;
    color: #f5f5f5;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(220,39,67,0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: insta-pop 0.25s ease-out;
    top: 4vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(96vw, 440px);
    height: 92vh;
    max-height: 900px;
}
.panel.hidden { display: none; }
@keyframes insta-pop { from { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.95); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }

.header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #262626;
    flex-shrink: 0;
}
.header-title {
    font-family: "Billabong","Pacifico","Dancing Script",cursive;
    font-size: 26px;
    line-height: 1;
    background: linear-gradient(45deg, #f09433, #dc2743, #bc1888);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
}
.header-actions { display: flex; gap: 4px; }
.icon-btn {
    background: transparent; border: none;
    color: #f5f5f5;
    font-size: 18px;
    cursor: pointer;
    width: 32px; height: 32px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    -webkit-tap-highlight-color: transparent;
}
.icon-btn:active { background: #262626; }

.screen {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    min-height: 0;
}
.screen::-webkit-scrollbar { width: 6px; }
.screen::-webkit-scrollbar-thumb { background: #262626; border-radius: 3px; }

.nav {
    display: flex;
    justify-content: space-around;
    align-items: center;
    border-top: 1px solid #262626;
    padding: 6px 0 8px;
    background: #000;
    flex-shrink: 0;
}
.nav-item {
    background: transparent; border: none;
    color: #f5f5f5;
    cursor: pointer;
    padding: 6px 10px;
    opacity: 0.7;
    -webkit-tap-highlight-color: transparent;
    position: relative;
}
.nav-item svg { width: 24px; height: 24px; }
.nav-item.active { opacity: 1; }
.nav-item.active svg { stroke-width: 2.5; }
.nav-item .nav-dot { position: absolute; top: 4px; right: 6px; width: 8px; height: 8px; background: #ff2d55; border-radius: 50%; display: none; }
.nav-item.has-new .nav-dot { display: block; }

/* Stories bar */
.stories { display: flex; gap: 14px; padding: 12px 14px; overflow-x: auto; border-bottom: 1px solid #262626; }
.stories::-webkit-scrollbar { display: none; }
.story { flex-shrink: 0; width: 66px; cursor: pointer; text-align: center; -webkit-tap-highlight-color: transparent; }
.story-ring {
    width: 62px; height: 62px; border-radius: 50%;
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    padding: 2px; margin: 0 auto;
}
.story-ring img { width: 100%; height: 100%; border-radius: 50%; border: 2px solid #000; object-fit: cover; display: block; }
.story-name { font-size: 11px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Post card */
.post { border-bottom: 1px solid #262626; padding-bottom: 10px; }
.post-head { display: flex; align-items: center; padding: 10px 14px; gap: 10px; }
.post-user { display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1; -webkit-tap-highlight-color: transparent; }
.avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; background: #121212; }
.post-user-info { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.username { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; }
.post-mood { font-size: 11px; color: #737373; }
.post-menu { cursor: pointer; font-size: 20px; padding: 4px 8px; color: #f5f5f5; -webkit-tap-highlight-color: transparent; }

.post-image-wrap { width: 100%; aspect-ratio: 1/1; background: #121212; overflow: hidden; position: relative; }
.post-image { width: 100%; height: 100%; object-fit: cover; display: block; }
.post-image-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #737373; font-size: 12px; background: #121212; }

.post-actions { display: flex; align-items: center; padding: 8px 10px 4px; gap: 4px; }
.act-btn { background: transparent; border: none; color: #f5f5f5; padding: 6px; cursor: pointer; border-radius: 50%; -webkit-tap-highlight-color: transparent; }
.act-btn svg { width: 24px; height: 24px; }
.save { margin-left: auto; }
.post-likes { padding: 2px 14px; font-size: 14px; font-weight: 600; }
.post-caption { padding: 4px 14px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
.post-caption b { font-weight: 600; margin-right: 4px; }
.tag { color: #0095f6; margin-right: 4px; }
.post-comments { padding: 2px 14px; }
.comment { font-size: 14px; line-height: 1.4; padding: 2px 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.comment-text { flex: 1; word-wrap: break-word; }
.comment b { font-weight: 600; margin-right: 4px; }
.comment-del { background: none; border: none; color: #737373; font-size: 12px; cursor: pointer; padding: 2px 6px; opacity: 0; transition: opacity 0.2s; -webkit-tap-highlight-color: transparent; }
.comment:hover .comment-del { opacity: 1; }
.comment-del:hover { color: #ed4956; }
.comment-more { padding: 2px 14px; font-size: 13px; color: #737373; cursor: pointer; }
.post-time { padding: 4px 14px; font-size: 11px; color: #737373; text-transform: uppercase; }
.comment-box { display: flex; align-items: center; padding: 8px 14px; border-top: 1px solid #121212; margin-top: 4px; gap: 8px; }
.comment-input { flex: 1; background: transparent; border: none; color: #f5f5f5; font-size: 14px; outline: none; padding: 6px 0; font-family: inherit; }
.comment-input::placeholder { color: #737373; }
.comment-post { background: transparent; border: none; color: #0095f6; font-weight: 600; cursor: pointer; font-size: 14px; -webkit-tap-highlight-color: transparent; }
.comment-post:disabled { color: #0955a0; }

/* Context menu for post */
.post-menu-pop { position: absolute; background: #262626; border-radius: 10px; padding: 6px 0; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 50; }
.post-menu-item { padding: 10px 14px; font-size: 14px; color: #f5f5f5; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.post-menu-item:active { background: #363636; }
.post-menu-item.danger { color: #ed4956; }

.empty { padding: 60px 20px; text-align: center; color: #a8a8a8; }
.empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.6; }
.empty-title { font-size: 18px; font-weight: 600; color: #f5f5f5; margin-bottom: 8px; }
.empty-sub { font-size: 13px; line-height: 1.5; color: #737373; }
.empty-small { padding: 40px 20px; text-align: center; color: #737373; font-size: 13px; }

/* Profile */
.profile-head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #262626; gap: 8px; flex-shrink: 0; }
.back-btn { background: transparent; border: none; color: #f5f5f5; font-size: 22px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.profile-username { font-weight: 700; font-size: 16px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.profile-body { padding: 14px; }
.profile-top { display: flex; align-items: center; gap: 24px; margin-bottom: 14px; }
.profile-avatar-wrap { position: relative; }
.profile-avatar { width: 86px; height: 86px; border-radius: 50%; object-fit: cover; border: 1px solid #262626; background: #121212; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.profile-avatar-edit { position: absolute; bottom: 0; right: 0; background: #0095f6; color: white; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 14px; border: 2px solid #000; cursor: pointer; }
.profile-stats { display: flex; gap: 18px; flex: 1; justify-content: space-around; }
.profile-stats > div { text-align: center; display: flex; flex-direction: column; font-size: 13px; }
.profile-stats b { font-size: 17px; font-weight: 700; }
.profile-stats span { color: #a8a8a8; }
.profile-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.profile-bio { font-size: 13px; line-height: 1.4; margin-bottom: 12px; white-space: pre-wrap; word-wrap: break-word; }
.profile-actions { display: flex; gap: 6px; margin-bottom: 14px; }
.follow-btn, .msg-btn { flex: 1; padding: 8px; border-radius: 8px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.follow-btn { background: #0095f6; color: white; }
.follow-btn.following { background: #262626; color: #f5f5f5; }
.msg-btn { background: #262626; color: #f5f5f5; }
.post-now-btn { width: 100%; padding: 8px; margin-bottom: 14px; background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); color: white; border: none; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.post-now-btn:disabled { opacity: 0.5; }

.profile-grid, .discover-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2px;
    margin-top: 8px;
}
.grid-item { aspect-ratio: 1/1; background: #121212; overflow: hidden; cursor: pointer; position: relative; -webkit-tap-highlight-color: transparent; }
.grid-item img { width: 100%; height: 100%; object-fit: cover; }

/* Compose */
.compose { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.compose-title { font-size: 18px; font-weight: 700; }
.compose-preview { display: none; border-radius: 8px; overflow: hidden; background: #121212; position: relative; }
.compose-preview img { width: 100%; max-height: 300px; object-fit: cover; display: block; }
.compose-preview .remove { width: 100%; padding: 6px; background: #262626; color: #ed4956; border: none; cursor: pointer; font-size: 12px; -webkit-tap-highlight-color: transparent; }
.compose-file-btn {
    display: block;
    padding: 10px;
    text-align: center;
    cursor: pointer;
    background: #262626;
    color: #f5f5f5;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
}
.compose textarea, .compose input, .inline-input {
    width: 100%; padding: 10px 12px; border-radius: 8px; background: #121212;
    border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none;
    font-family: inherit; resize: vertical; box-sizing: border-box;
}
.compose-label { font-size: 12px; color: #a8a8a8; }
.compose-hint { font-size: 11px; color: #737373; }
.primary-btn { padding: 10px; background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; -webkit-tap-highlight-color: transparent; }
.primary-btn:disabled { opacity: 0.5; }
.danger-btn { padding: 10px; background: transparent; color: #ed4956; border: 1px solid #ed4956; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 8px; -webkit-tap-highlight-color: transparent; }

/* Search */
.search-bar { padding: 8px 14px; border-bottom: 1px solid #262626; }
.search-bar input { width: 100%; padding: 8px 12px; border-radius: 8px; background: #262626; border: none; color: #f5f5f5; font-size: 14px; outline: none; }

/* DM */
.dm-header { padding: 14px; }
.dm-title { font-size: 18px; font-weight: 700; }
.dm-list { display: flex; flex-direction: column; }
.dm-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.dm-item:active { background: #121212; }
.dm-info { flex: 1; min-width: 0; }
.dm-name { font-weight: 600; font-size: 14px; }
.dm-preview { font-size: 13px; color: #a8a8a8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dm-chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262626; flex-shrink: 0; }
.dm-chat-name { font-weight: 600; font-size: 15px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dm-chat-actions { display: flex; gap: 4px; }
.dm-thread { padding: 14px; display: flex; flex-direction: column; gap: 8px; min-height: 280px; }
.dm-msg-wrap { display: flex; flex-direction: column; max-width: 78%; }
.dm-msg-wrap.user { align-self: flex-end; align-items: flex-end; }
.dm-msg-wrap.char { align-self: flex-start; align-items: flex-start; }
.dm-msg { padding: 8px 12px; border-radius: 18px; font-size: 14px; line-height: 1.35; word-wrap: break-word; position: relative; cursor: default; }
.dm-msg.user { background: #0095f6; color: white; border-bottom-right-radius: 4px; }
.dm-msg.char { background: #262626; color: #f5f5f5; border-bottom-left-radius: 4px; }
.dm-msg-actions { display: flex; gap: 8px; margin-top: 4px; padding: 0 4px; }
.dm-msg-action { background: none; border: none; color: #737373; font-size: 11px; cursor: pointer; padding: 2px 6px; -webkit-tap-highlight-color: transparent; }
.dm-msg-action:hover { color: #f5f5f5; }
.dm-input-wrap { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #262626; flex-shrink: 0; }
.dm-input-wrap input { flex: 1; padding: 10px 14px; border-radius: 20px; background: #262626; border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none; }
.dm-input-wrap button { padding: 8px 16px; background: transparent; color: #0095f6; border: none; font-weight: 700; cursor: pointer; font-size: 14px; -webkit-tap-highlight-color: transparent; }
.dm-input-wrap button:disabled { color: #0955a0; }

/* Toast */
.toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%) translateY(30px);
    background: #262626;
    color: #f5f5f5;
    padding: 10px 20px;
    border-radius: 24px;
    font-size: 14px;
    opacity: 0;
    transition: all 0.3s;
    pointer-events: none;
    border: 1px solid #363636;
    z-index: 100;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Modal */
.modal-root { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 200; pointer-events: none; }
.modal-root.open { pointer-events: auto; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.7); }
.modal {
    position: relative;
    background: #1a1a1a;
    border-radius: 16px;
    padding: 20px;
    max-width: 90vw;
    width: 380px;
    max-height: 86vh;
    overflow-y: auto;
    animation: insta-pop 0.2s ease-out;
    color: #f5f5f5;
    border: 1px solid #262626;
}
.modal-title { font-size: 16px; font-weight: 700; margin-bottom: 14px; }
.modal label { font-size: 12px; color: #a8a8a8; display: block; margin-top: 10px; margin-bottom: 4px; }
.modal input, .modal textarea { width: 100%; padding: 8px 10px; border-radius: 8px; background: #121212; border: 1px solid #262626; color: #f5f5f5; font-size: 14px; outline: none; font-family: inherit; box-sizing: border-box; }
.modal-avatar-preview { width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 10px; display: block; object-fit: cover; border: 2px solid #262626; background: #121212; }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; }
.modal-actions button { flex: 1; padding: 10px; border-radius: 8px; border: none; font-weight: 600; font-size: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.modal-actions .cancel { background: #262626; color: #f5f5f5; }
.modal-actions .confirm { background: #0095f6; color: white; }

/* Settings inline in panel */
.settings-section { padding: 14px; border-top: 1px solid #262626; }
.settings-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 14px; gap: 10px; }
.settings-row .label { flex: 1; }
.settings-row .hint { font-size: 11px; color: #737373; margin-top: 2px; }
.mini-toggle { position: relative; display: inline-block; width: 42px; height: 22px; }
.mini-toggle input { opacity: 0; width: 0; height: 0; }
.mini-toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #363636; border-radius: 22px; transition: 0.3s; }
.mini-toggle-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.3s; }
.mini-toggle input:checked + .mini-toggle-slider { background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); }
.mini-toggle input:checked + .mini-toggle-slider:before { transform: translateX(20px); }

@media (max-width: 380px) {
    .panel { top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; max-height: none; border-radius: 0; transform: none; }
    @keyframes insta-pop { from { opacity: 0; } to { opacity: 1; } }
}
`;

// ---------- Mount UI ----------
function mountUI() {
    try {
        buildShadowHost();
        shadowRoot.innerHTML =
            "<style>" + SHADOW_CSS + "</style>" +
            '<div id="floater" class="floater" title="InstaChar">' + IG_SVG + '<span id="badge" class="badge hidden">0</span></div>' +
            '<div id="panel" class="panel hidden">' +
                '<div class="header">' +
                    '<div class="header-title">Instagram</div>' +
                    '<div class="header-actions">' +
                        '<button class="icon-btn" id="btn-refresh" title="Refresh">⟳</button>' +
                        '<button class="icon-btn" id="btn-close" title="Close">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div class="screen" id="screen"><div id="view"></div></div>' +
                '<div class="nav">' +
                    '<button class="nav-item" data-tab="feed" title="Feed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg><span class="nav-dot"></span></button>' +
                    '<button class="nav-item" data-tab="discover" title="Explore"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>' +
                    '<button class="nav-item" data-tab="post" title="Post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></button>' +
                    '<button class="nav-item" data-tab="dm" title="Messages"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><span class="nav-dot"></span></button>' +
                    '<button class="nav-item" data-tab="profile" title="Profile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>' +
                '</div>' +
            '</div>' +
            '<div id="toast" class="toast"></div>' +
            '<div id="modal-root" class="modal-root"></div>';

        const floater = shadowRoot.getElementById("floater");
        const panel = shadowRoot.getElementById("panel");

        // Drag & click
        let pDown = false, pStartX = 0, pStartY = 0, pMoved = false;
        floater.addEventListener("pointerdown", (e) => {
            pDown = true; pStartX = e.clientX; pStartY = e.clientY; pMoved = false;
            floater.classList.add("pressed");
            try { floater.setPointerCapture(e.pointerId); } catch {}
        });
        floater.addEventListener("pointermove", (e) => {
            if (!pDown) return;
            const dx = e.clientX - pStartX, dy = e.clientY - pStartY;
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) pMoved = true;
            if (pMoved) {
                const r = floater.getBoundingClientRect();
                const newRight = Math.max(8, Math.min(window.innerWidth - 68, window.innerWidth - r.right - dx));
                const newTop = Math.max(8, Math.min(window.innerHeight - 68, r.top + dy));
                floater.style.right = newRight + "px";
                floater.style.top = newTop + "px";
                floater.style.bottom = "auto";
                pStartX = e.clientX; pStartY = e.clientY;
            }
        });
        floater.addEventListener("pointerup", () => {
            floater.classList.remove("pressed");
            if (!pDown) return;
            pDown = false;
            if (pMoved) {
                const r = floater.getBoundingClientRect();
                getSettings().iconPos = { right: Math.round(window.innerWidth - r.right), top: Math.round(r.top) };
                save();
            } else { togglePanel(); }
        });
        floater.addEventListener("pointercancel", () => { pDown = false; pMoved = false; floater.classList.remove("pressed"); });

        const s = getSettings();
        if (s.iconPos) {
            if (typeof s.iconPos.right === "number") floater.style.right = s.iconPos.right + "px";
            if (typeof s.iconPos.top === "number") { floater.style.top = s.iconPos.top + "px"; floater.style.bottom = "auto"; }
        }
        setFloaterVisible(s.iconVisible);

        shadowRoot.getElementById("btn-close").addEventListener("click", closePanel);
        shadowRoot.getElementById("btn-refresh").addEventListener("click", () => renderCurrentTab());

        shadowRoot.querySelectorAll(".nav-item").forEach(btn => {
            btn.addEventListener("click", () => {
                const cd = getChatData();
                cd.currentTab = btn.dataset.tab;
                cd.selectedProfile = null;
                save();
                renderCurrentTab();
                updateNavActive();
            });
        });

        setInterval(updateUnreadDots, 5000);
        log("UI mounted");
    } catch (e) {
        log("mountUI failed: " + e.message, true);
    }
}

function setFloaterVisible(visible) {
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (!el) return;
    if (visible) el.classList.remove("hidden"); else el.classList.add("hidden");
}

function flashIcon() {
    updateBadge();
    updateUnreadDots();
    if (!shadowRoot) return;
    const el = shadowRoot.getElementById("floater");
    if (el) {
        el.style.animation = "insta-idle 0.4s ease-in-out 3";
        setTimeout(() => { el.style.animation = ""; }, 1500);
    }
}

function openPanel() {
    if (!shadowRoot) return;
    shadowRoot.getElementById("panel").classList.remove("hidden");
    const cd = getChatData();
    cd.unreadCount = 0;
    save();
    updateBadge();
    renderCurrentTab();
    updateNavActive();
}

function closePanel() {
    if (!shadowRoot) return;
    shadowRoot.getElementById("panel").classList.add("hidden");
}

function togglePanel() {
    if (isPanelOpen()) closePanel(); else openPanel();
}

function isPanelOpen() {
    if (!shadowRoot) return false;
    const p = shadowRoot.getElementById("panel");
    return p && !p.classList.contains("hidden");
}

function updateBadge() {
    if (!shadowRoot) return;
    const cd = getChatData();
    const badge = shadowRoot.getElementById("badge");
    if (!badge) return;
    if (cd.unreadCount > 0) {
        badge.textContent = cd.unreadCount > 99 ? "99+" : cd.unreadCount;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
}

function updateUnreadDots() {
    if (!shadowRoot) return;
    const cd = getChatData();
    // DM unread: any char has a recent char-message unseen
    const dmBtn = shadowRoot.querySelector('.nav-item[data-tab="dm"]');
    if (dmBtn) {
        let hasNew = false;
        for (const [name, thread] of Object.entries(cd.dms || {})) {
            const last = thread[thread.length - 1];
            if (last && last.from === "char" && !last.seen) { hasNew = true; break; }
        }
        dmBtn.classList.toggle("has-new", hasNew);
    }
    // Feed: any post from last 5 min
    const feedBtn = shadowRoot.querySelector('.nav-item[data-tab="feed"]');
    if (feedBtn) {
        const recent = (cd.posts || []).some(p => !p.isUserPost && (Date.now() - p.timestamp) < 300000 && !p.seen);
        feedBtn.classList.toggle("has-new", recent);
    }
}

function updateNavActive() {
    if (!shadowRoot) return;
    const cd = getChatData();
    shadowRoot.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === cd.currentTab);
    });
}

function toast(msg) {
    if (!shadowRoot) return;
    const t = shadowRoot.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Modal helpers ----------
function openModal(html) {
    if (!shadowRoot) return;
    const root = shadowRoot.getElementById("modal-root");
    root.innerHTML = '<div class="modal-backdrop"></div><div class="modal">' + html + '</div>';
    root.classList.add("open");
    root.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    return root.querySelector(".modal");
}

function closeModal() {
    if (!shadowRoot) return;
    const root = shadowRoot.getElementById("modal-root");
    if (root) { root.innerHTML = ""; root.classList.remove("open"); }
}

// ---------- Renderers ----------
function renderCurrentTab() {
    const cd = getChatData();
    if (cd.selectedProfile) return renderProfile(cd.selectedProfile);
    switch (cd.currentTab) {
        case "feed": return renderFeed();
        case "discover": return renderDiscover();
        case "post": return renderCompose();
        case "dm": return renderDMList();
        case "profile": return renderMyProfile();
        default: return renderFeed();
    }
}

function renderFeed() {
    if (!shadowRoot) return;
    const cd = getChatData();
    const view = shadowRoot.getElementById("view");
    if (!view) return;

    // Merge user posts and char posts, sort by time desc
    const allPosts = [...cd.posts].sort((a, b) => b.timestamp - a.timestamp);

    if (allPosts.length === 0) {
        view.innerHTML = '<div class="empty"><div class="empty-icon">📷</div><div class="empty-title">ยังไม่มีโพสต์</div><div class="empty-sub">คุยกับตัวละคร เขาจะโพสต์เอง!<br>หรือไปที่โปรไฟล์ตัวละครกดปุ่ม "โพสต์เลย"</div></div>';
        return;
    }

    view.innerHTML = renderStoriesBar() + allPosts.map(renderPostCard).join("");
    attachFeedHandlers();
}

function renderStoriesBar() {
    const cd = getChatData();
    const chars = Object.entries(cd.charProfiles);
    if (chars.length === 0) return "";
    return '<div class="stories">' + chars.map(([name, p]) =>
        '<div class="story" data-profile="' + escapeHtml(name) + '">' +
            '<div class="story-ring"><img src="' + escapeHtml(p.avatar) + '" onerror="this.src=\'' + defaultAvatar(name) + '\'"/></div>' +
            '<div class="story-name">' + escapeHtml(p.username) + '</div>' +
        '</div>'
    ).join("") + '</div>';
}

function renderPostCard(post) {
    const liked = post.userLiked;
    const heart = liked ?
        '<svg viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' :
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

    const allComments = [...(post.comments || []), ...(post.userComments || [])];
    const shownComments = allComments.slice(0, 3);
    const remaining = allComments.length - shownComments.length;
    const commentsHtml = shownComments.map((c, idx) => {
        const isUserComment = (post.userComments || []).indexOf(c) >= 0;
        return '<div class="comment"><span class="comment-text"><b>' + escapeHtml(c.username) + '</b> ' + escapeHtml(c.text) + '</span>' +
            '<button class="comment-del" data-post="' + post.id + '" data-idx="' + idx + '" data-user="' + (isUserComment ? "1" : "0") + '">✕</button></div>';
    }).join("");
    const moreComments = remaining > 0 ? '<div class="comment-more" data-post="' + post.id + '">ดูคอมเมนต์ทั้งหมด ' + allComments.length + ' รายการ</div>' : "";
    const hashtagHtml = (post.hashtags || []).map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join(" ");

    return '<article class="post" data-post="' + post.id + '">' +
        '<header class="post-head">' +
            '<div class="post-user" data-profile="' + escapeHtml(post.author) + '">' +
                '<img class="avatar" src="' + escapeHtml(post.authorAvatar) + '" onerror="this.src=\'' + defaultAvatar(post.author) + '\'"/>' +
                '<div class="post-user-info">' +
                    '<div class="username">' + escapeHtml(post.authorUsername || post.author) + '</div>' +
                    (post.mood ? '<div class="post-mood">' + escapeHtml(post.mood) + '</div>' : "") +
                '</div>' +
            '</div>' +
            '<div class="post-menu" data-post="' + post.id + '">⋯</div>' +
        '</header>' +
        '<div class="post-image-wrap"><img class="post-image" src="' + escapeHtml(post.image) + '" loading="lazy" onerror="this.style.display=\'none\'"/></div>' +
        '<div class="post-actions">' +
            '<button class="act-btn like-btn" data-post="' + post.id + '">' + heart + '</button>' +
            '<button class="act-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>' +
            '<button class="act-btn save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>' +
        '</div>' +
        '<div class="post-likes">' + (post.likes || 0).toLocaleString() + ' คนกดใจ</div>' +
        '<div class="post-caption"><b>' + escapeHtml(post.authorUsername || post.author) + '</b> ' + escapeHtml(post.caption) + ' ' + hashtagHtml + '</div>' +
        '<div class="post-comments">' + commentsHtml + '</div>' +
        moreComments +
        '<div class="post-time">' + timeAgo(post.timestamp) + 'ที่แล้ว</div>' +
        '<div class="comment-box">' +
            '<input type="text" class="comment-input" data-post="' + post.id + '" placeholder="เพิ่มความคิดเห็น..."/>' +
            '<button class="comment-post" data-post="' + post.id + '">โพสต์</button>' +
        '</div>' +
    '</article>';
}

function attachFeedHandlers() {
    if (!shadowRoot) return;
    shadowRoot.querySelectorAll(".like-btn").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(btn.dataset.post); });
    });
    shadowRoot.querySelectorAll(".post-user, .story").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cd = getChatData();
            cd.selectedProfile = el.dataset.profile;
            save();
            renderProfile(el.dataset.profile);
        });
    });
    shadowRoot.querySelectorAll(".comment-post").forEach(btn => {
        btn.addEventListener("click", () => addUserComment(btn.dataset.post));
    });
    shadowRoot.querySelectorAll(".comment-input").forEach(inp => {
        inp.addEventListener("keypress", (e) => { if (e.key === "Enter") addUserComment(inp.dataset.post); });
    });
    shadowRoot.querySelectorAll(".comment-del").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteComment(btn.dataset.post, parseInt(btn.dataset.idx), btn.dataset.user === "1");
        });
    });
    shadowRoot.querySelectorAll(".post-menu").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); showPostMenu(btn.dataset.post, btn); });
    });
}

function toggleLike(postId) {
    const cd = getChatData();
    const post = cd.posts.find(p => p.id === postId);
    if (!post) return;
    post.userLiked = !post.userLiked;
    post.likes = (post.likes || 0) + (post.userLiked ? 1 : -1);
    save();
    renderCurrentTab();
}

function addUserComment(postId) {
    const cd = getChatData();
    const s = getSettings();
    const post = cd.posts.find(p => p.id === postId);
    if (!post) return;
    const input = shadowRoot.querySelector('.comment-input[data-post="' + postId + '"]');
    if (!input || !input.value.trim()) return;
    post.userComments = post.userComments || [];
    post.userComments.push({
        username: s.userProfile.username || sanitizeUsername(getUserName()),
        text: input.value.trim(),
        timestamp: Date.now(),
    });
    input.value = "";
    save();
    renderCurrentTab();
}

function deleteComment(postId, idx, isUserComment) {
    const cd = getChatData();
    const post = cd.posts.find(p => p.id === postId);
    if (!post) return;
    // Figure out which list this idx belongs to
    const npcLen = (post.comments || []).length;
    if (idx < npcLen) {
        post.comments.splice(idx, 1);
    } else {
        post.userComments.splice(idx - npcLen, 1);
    }
    save();
    renderCurrentTab();
}

function showPostMenu(postId, anchor) {
    const cd = getChatData();
    const post = cd.posts.find(p => p.id === postId);
    if (!post) return;

    // Close any existing
    shadowRoot.querySelectorAll(".post-menu-pop").forEach(el => el.remove());

    const menu = document.createElement("div");
    menu.className = "post-menu-pop";
    menu.innerHTML =
        (post.isUserPost ? '<div class="post-menu-item" data-a="edit">แก้ไข caption</div>' : '') +
        '<div class="post-menu-item" data-a="regen">สร้างรูปใหม่</div>' +
        '<div class="post-menu-item danger" data-a="del">ลบโพสต์</div>';

    const rect = anchor.getBoundingClientRect();
    menu.style.right = (window.innerWidth - rect.right) + "px";
    menu.style.top = (rect.bottom + 4) + "px";
    shadowRoot.appendChild(menu);

    menu.addEventListener("click", (e) => {
        const item = e.target.closest(".post-menu-item");
        if (!item) return;
        const a = item.dataset.a;
        menu.remove();
        if (a === "del") {
            if (confirm("ลบโพสต์นี้?")) {
                cd.posts = cd.posts.filter(p => p.id !== postId);
                save();
                renderCurrentTab();
                toast("ลบโพสต์แล้ว");
            }
        } else if (a === "regen") {
            post.image = makeImageUrl(post.imagePrompt || post.caption, Date.now());
            save();
            renderCurrentTab();
            toast("สร้างรูปใหม่");
        } else if (a === "edit") {
            const newCap = prompt("แก้ไข caption:", post.caption);
            if (newCap !== null) {
                post.caption = newCap;
                save();
                renderCurrentTab();
            }
        }
    });

    setTimeout(() => {
        const closer = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                shadowRoot.removeEventListener("click", closer);
            }
        };
        shadowRoot.addEventListener("click", closer);
    }, 10);
}

// ---------- Profile ----------
function renderProfile(charName) {
    if (!shadowRoot) return;
    const cd = getChatData();
    const profile = ensureCharProfile(charName);
    if (!profile) return;
    const view = shadowRoot.getElementById("view");
    const posts = cd.posts.filter(p => p.author === charName).sort((a, b) => b.timestamp - a.timestamp);

    view.innerHTML =
        '<div class="profile-head">' +
            '<button class="back-btn" id="back">←</button>' +
            '<div class="profile-username">' + escapeHtml(profile.username) + '</div>' +
            '<div></div>' +
        '</div>' +
        '<div class="profile-body">' +
            '<div class="profile-top">' +
                '<div class="profile-avatar-wrap">' +
                    '<img class="profile-avatar" src="' + escapeHtml(profile.avatar) + '" onerror="this.src=\'' + defaultAvatar(charName) + '\'"/>' +
                '</div>' +
                '<div class="profile-stats">' +
                    '<div><b>' + posts.length + '</b><span>โพสต์</span></div>' +
                    '<div><b>' + profile.followers.toLocaleString() + '</b><span>ผู้ติดตาม</span></div>' +
                    '<div><b>' + profile.following.toLocaleString() + '</b><span>กำลังติดตาม</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="profile-name">' + escapeHtml(profile.displayName) + '</div>' +
            '<div class="profile-bio">' + escapeHtml(profile.bio || "") + '</div>' +
            '<div class="profile-actions">' +
                '<button class="follow-btn ' + (profile.userFollowing ? "following" : "") + '" id="follow">' + (profile.userFollowing ? "กำลังติดตาม" : "ติดตาม") + '</button>' +
                '<button class="msg-btn" id="msg">ข้อความ</button>' +
            '</div>' +
            '<button class="post-now-btn" id="post-now">✨ โพสต์เลย (manual)</button>' +
            '<div class="profile-grid">' +
                (posts.length === 0 ? '<div class="empty-small">ยังไม่มีโพสต์</div>' :
                    posts.map(p => '<div class="grid-item" data-post="' + p.id + '"><img src="' + escapeHtml(p.image) + '" loading="lazy"/></div>').join("")) +
            '</div>' +
        '</div>';

    shadowRoot.getElementById("back").addEventListener("click", () => {
        cd.selectedProfile = null;
        save();
        renderCurrentTab();
    });
    shadowRoot.getElementById("follow").addEventListener("click", () => {
        profile.userFollowing = !profile.userFollowing;
        profile.followers += profile.userFollowing ? 1 : -1;
        save();
        renderProfile(charName);
    });
    shadowRoot.getElementById("msg").addEventListener("click", () => {
        cd.currentTab = "dm";
        cd.selectedProfile = null;
        save();
        openDM(charName);
    });
    shadowRoot.getElementById("post-now").addEventListener("click", async () => {
        const btn = shadowRoot.getElementById("post-now");
        btn.disabled = true;
        btn.textContent = "กำลังโพสต์...";
        try {
            await generateAmbientPost(charName);
            toast(charName + " โพสต์แล้ว!");
        } catch {}
        btn.disabled = false;
        btn.textContent = "✨ โพสต์เลย (manual)";
        renderProfile(charName);
    });
}

// ---------- Discover ----------
function renderDiscover() {
    if (!shadowRoot) return;
    const cd = getChatData();
    const view = shadowRoot.getElementById("view");
    const posts = [...cd.posts].sort((a, b) => b.timestamp - a.timestamp);
    view.innerHTML =
        '<div class="search-bar"><input type="text" placeholder="ค้นหา"/></div>' +
        (posts.length === 0 ? '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">ยังไม่มีอะไรให้สำรวจ</div></div>' :
        '<div class="discover-grid">' +
            posts.map(p => '<div class="grid-item" data-profile="' + escapeHtml(p.author) + '"><img src="' + escapeHtml(p.image) + '" loading="lazy"/></div>').join("") +
        '</div>');
    shadowRoot.querySelectorAll(".grid-item").forEach(el => {
        el.addEventListener("click", () => {
            cd.selectedProfile = el.dataset.profile;
            save();
            renderProfile(el.dataset.profile);
        });
    });
}

// ---------- Compose ----------
let composeUploadedDataUrl = null;

function renderCompose() {
    if (!shadowRoot) return;
    const view = shadowRoot.getElementById("view");
    composeUploadedDataUrl = null;
    view.innerHTML =
        '<div class="compose">' +
            '<div class="compose-title">โพสต์ใหม่</div>' +
            '<div id="compose-preview" class="compose-preview">' +
                '<img id="compose-preview-img"/>' +
                '<button class="remove" id="compose-remove">✕ ลบรูป</button>' +
            '</div>' +
            '<label class="compose-file-btn" for="compose-file">📷 เลือกรูปจากเครื่อง</label>' +
            '<input type="file" id="compose-file" accept="image/*" style="display:none"/>' +
            '<textarea id="compose-caption" placeholder="เขียน caption..." rows="3"></textarea>' +
            '<label class="compose-label">หรือให้ AI สร้างรูป (prompt ภาษาอังกฤษ):</label>' +
            '<input type="text" id="compose-image" placeholder="sunset beach aesthetic..."/>' +
            '<div class="compose-hint">ถ้าไม่อัพโหลด + ไม่มี prompt จะ random ให้</div>' +
            '<button id="compose-post" class="primary-btn">โพสต์</button>' +
            '<div id="compose-status" style="font-size:13px;color:#a8a8a8;text-align:center;padding:4px"></div>' +
        '</div>';

    const fileInput = shadowRoot.getElementById("compose-file");
    const preview = shadowRoot.getElementById("compose-preview");
    const previewImg = shadowRoot.getElementById("compose-preview-img");

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            toast("รูปใหญ่เกิน 5MB");
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            composeUploadedDataUrl = ev.target.result;
            previewImg.src = composeUploadedDataUrl;
            preview.style.display = "block";
        };
        reader.readAsDataURL(file);
    });
    shadowRoot.getElementById("compose-remove").addEventListener("click", () => {
        composeUploadedDataUrl = null;
        fileInput.value = "";
        preview.style.display = "none";
    });
    shadowRoot.getElementById("compose-post").addEventListener("click", submitUserPost);
}

async function submitUserPost() {
    const cd = getChatData();
    const s = getSettings();
    const caption = shadowRoot.getElementById("compose-caption").value.trim();
    const imgInput = shadowRoot.getElementById("compose-image").value.trim();
    const statusEl = shadowRoot.getElementById("compose-status");

    let imageUrl, imagePrompt = "";
    if (composeUploadedDataUrl) {
        imageUrl = composeUploadedDataUrl;
        imagePrompt = caption || "user photo";
    } else if (imgInput.startsWith("http")) {
        imageUrl = imgInput;
        imagePrompt = caption;
    } else {
        imagePrompt = imgInput || caption || "aesthetic photo";
        imageUrl = makeImageUrl(imagePrompt);
    }

    const userName = getUserName();
    const post = {
        id: "p_" + Date.now() + "_" + Math.floor(Math.random() * 999),
        author: userName,
        authorUsername: s.userProfile.username || sanitizeUsername(userName),
        authorAvatar: s.userProfile.avatar || defaultAvatar(userName),
        caption, hashtags: [], image: imageUrl, imagePrompt,
        timestamp: Date.now(), likes: 0, userLiked: false,
        comments: [], userComments: [], isUserPost: true,
    };
    cd.posts.push(post);
    save();
    statusEl.textContent = "โพสต์แล้ว ✓ รอให้ตัวละคร react...";

    // Go to feed immediately
    cd.currentTab = "feed";
    save();
    renderCurrentTab();
    updateNavActive();

    // React in background
    const charNames = Object.keys(cd.charProfiles);
    for (const name of charNames) {
        try {
            const reaction = await generateCharReaction(name, post);
            if (reaction && reaction.like) post.likes = (post.likes || 0) + 1;
            if (reaction && reaction.comment) {
                post.comments.push({
                    username: cd.charProfiles[name].username,
                    text: reaction.comment,
                    timestamp: Date.now(),
                });
            }
            save();
            if (isPanelOpen() && cd.currentTab === "feed" && !cd.selectedProfile) renderCurrentTab();
        } catch {}
    }
}

// ---------- DM ----------
function renderDMList() {
    if (!shadowRoot) return;
    const cd = getChatData();
    const view = shadowRoot.getElementById("view");
    const chars = Object.entries(cd.charProfiles)
        .map(([name, p]) => ({ name, profile: p, thread: cd.dms[name] || [] }))
        .sort((a, b) => {
            const at = a.thread.length ? a.thread[a.thread.length - 1].timestamp : 0;
            const bt = b.thread.length ? b.thread[b.thread.length - 1].timestamp : 0;
            return bt - at;
        });

    view.innerHTML =
        '<div class="dm-header"><div class="dm-title">ข้อความ</div></div>' +
        '<div class="dm-list">' +
            (chars.length === 0 ? '<div class="empty-small">ยังไม่มีคนคุย<br><br>เมื่อมีตัวละครปรากฏใน RP จะมีให้คุยตรงนี้</div>' :
                chars.map(({ name, profile: p, thread }) => {
                    const last = thread[thread.length - 1];
                    return '<div class="dm-item" data-char="' + escapeHtml(name) + '">' +
                        '<img class="avatar" src="' + escapeHtml(p.avatar) + '" onerror="this.src=\'' + defaultAvatar(name) + '\'"/>' +
                        '<div class="dm-info">' +
                            '<div class="dm-name">' + escapeHtml(p.displayName) + '</div>' +
                            '<div class="dm-preview">' + (last ? escapeHtml(last.text.slice(0, 50)) : "เริ่มคุย...") + '</div>' +
                        '</div>' +
                    '</div>';
                }).join("")) +
        '</div>';
    shadowRoot.querySelectorAll(".dm-item").forEach(el => {
        el.addEventListener("click", () => openDM(el.dataset.char));
    });
}

function openDM(charName) {
    if (!shadowRoot) return;
    const cd = getChatData();
    const profile = ensureCharProfile(charName);
    const view = shadowRoot.getElementById("view");
    const thread = cd.dms[charName] || [];

    // Mark messages as seen
    thread.forEach(m => { m.seen = true; });
    save();

    view.innerHTML =
        '<div class="dm-chat-head">' +
            '<button class="back-btn" id="back">←</button>' +
            '<img class="avatar" src="' + escapeHtml(profile.avatar) + '" onerror="this.src=\'' + defaultAvatar(charName) + '\'"/>' +
            '<div class="dm-chat-name">' + escapeHtml(profile.displayName) + '</div>' +
            '<div class="dm-chat-actions"><button class="icon-btn" id="dm-clear" title="Clear chat">🗑️</button></div>' +
        '</div>' +
        '<div class="screen" id="dm-scroll" style="flex:1;overflow-y:auto">' +
            '<div class="dm-thread" id="dm-thread">' +
                thread.map((m, i) => renderDMMsg(m, i)).join("") +
                (thread.length === 0 ? '<div class="empty-small">ส่งข้อความแรกเลย</div>' : "") +
            '</div>' +
        '</div>' +
        '<div class="dm-input-wrap">' +
            '<input type="text" id="dm-input" placeholder="ข้อความ..."/>' +
            '<button id="dm-send">ส่ง</button>' +
        '</div>';

    // Scroll to bottom
    const screenEl = view.querySelector("#dm-scroll");
    if (screenEl) screenEl.scrollTop = screenEl.scrollHeight;

    shadowRoot.getElementById("back").addEventListener("click", () => {
        cd.selectedProfile = null;
        cd.currentTab = "dm";
        save();
        renderCurrentTab();
    });
    shadowRoot.getElementById("dm-clear").addEventListener("click", () => {
        if (confirm("ลบแชททั้งหมดกับ " + profile.displayName + "?")) {
            cd.dms[charName] = [];
            save();
            openDM(charName);
            toast("ล้างแชทแล้ว");
        }
    });

    const send = async () => {
        const inp = shadowRoot.getElementById("dm-input");
        const sendBtn = shadowRoot.getElementById("dm-send");
        const text = inp.value.trim();
        if (!text) return;
        cd.dms[charName] = cd.dms[charName] || [];
        cd.dms[charName].push({ from: "user", text, timestamp: Date.now(), seen: true });
        inp.value = "";
        save();
        openDM(charName);
        sendBtn.disabled = true;
        sendBtn.textContent = "...";
        try {
            await generateDMReply(charName);
        } catch {}
        sendBtn.disabled = false;
        sendBtn.textContent = "ส่ง";
        if (isPanelOpen()) openDM(charName);
    };
    shadowRoot.getElementById("dm-send").addEventListener("click", send);
    shadowRoot.getElementById("dm-input").addEventListener("keypress", (e) => {
        if (e.key === "Enter") send();
    });

    // Delete msg handlers
    shadowRoot.querySelectorAll(".dm-msg-action").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            const action = btn.dataset.action;
            if (action === "del") {
                cd.dms[charName].splice(idx, 1);
                save();
                openDM(charName);
            } else if (action === "edit") {
                const newText = prompt("แก้ไขข้อความ:", cd.dms[charName][idx].text);
                if (newText !== null && newText.trim()) {
                    cd.dms[charName][idx].text = newText.trim();
                    save();
                    openDM(charName);
                }
            }
        });
    });
}

function renderDMMsg(m, idx) {
    const isUser = m.from === "user";
    return '<div class="dm-msg-wrap ' + (isUser ? "user" : "char") + '">' +
        '<div class="dm-msg ' + (isUser ? "user" : "char") + '">' + escapeHtml(m.text) + '</div>' +
        (isUser ?
            '<div class="dm-msg-actions"><button class="dm-msg-action" data-idx="' + idx + '" data-action="edit">แก้ไข</button><button class="dm-msg-action" data-idx="' + idx + '" data-action="del">ลบ</button></div>' :
            '<div class="dm-msg-actions"><button class="dm-msg-action" data-idx="' + idx + '" data-action="del">ลบ</button></div>') +
    '</div>';
}

// ---------- My Profile ----------
function renderMyProfile() {
    if (!shadowRoot) return;
    const s = getSettings();
    const cd = getChatData();
    const view = shadowRoot.getElementById("view");
    const userName = getUserName();
    const myPosts = cd.posts.filter(p => p.isUserPost).sort((a, b) => b.timestamp - a.timestamp);

    const username = s.userProfile.username || sanitizeUsername(userName);
    const displayName = s.userProfile.displayName || userName;
    const avatar = s.userProfile.avatar || defaultAvatar(userName);

    view.innerHTML =
        '<div class="profile-head">' +
            '<div></div>' +
            '<div class="profile-username">' + escapeHtml(username) + '</div>' +
            '<div></div>' +
        '</div>' +
        '<div class="profile-body">' +
            '<div class="profile-top">' +
                '<div class="profile-avatar-wrap">' +
                    '<img class="profile-avatar" id="my-avatar" src="' + escapeHtml(avatar) + '"/>' +
                    '<div class="profile-avatar-edit" id="avatar-edit">📷</div>' +
                    '<input type="file" id="avatar-file" accept="image/*" style="display:none"/>' +
                '</div>' +
                '<div class="profile-stats">' +
                    '<div><b>' + myPosts.length + '</b><span>โพสต์</span></div>' +
                    '<div><b>' + Object.values(cd.charProfiles).filter(p => p.followsUser).length + '</b><span>ผู้ติดตาม</span></div>' +
                    '<div><b>' + Object.values(cd.charProfiles).filter(p => p.userFollowing).length + '</b><span>กำลังติดตาม</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="profile-name">' + escapeHtml(displayName) + '</div>' +
            '<div class="profile-bio">' + escapeHtml(s.userProfile.bio || "ยังไม่ได้เขียน bio") + '</div>' +
            '<button class="follow-btn" id="edit-profile">แก้ไขโปรไฟล์</button>' +
            '<div class="profile-grid">' +
                (myPosts.length === 0 ? '<div class="empty-small">ยังไม่มีโพสต์</div>' :
                    myPosts.map(p => '<div class="grid-item" data-post="' + p.id + '"><img src="' + escapeHtml(p.image) + '"/></div>').join("")) +
            '</div>' +
        '</div>';

    shadowRoot.getElementById("avatar-edit").addEventListener("click", () => {
        shadowRoot.getElementById("avatar-file").click();
    });
    shadowRoot.getElementById("avatar-file").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast("รูปใหญ่เกิน 2MB");
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            s.userProfile.avatar = ev.target.result;
            save();
            renderMyProfile();
            toast("เปลี่ยนรูปโปรไฟล์แล้ว ✓");
        };
        reader.readAsDataURL(file);
    });
    shadowRoot.getElementById("edit-profile").addEventListener("click", openEditProfileModal);
}

function openEditProfileModal() {
    const s = getSettings();
    const userName = getUserName();
    const currentUsername = s.userProfile.username || sanitizeUsername(userName);
    const currentDisplayName = s.userProfile.displayName || userName;

    const modal = openModal(
        '<div class="modal-title">แก้ไขโปรไฟล์</div>' +
        '<img class="modal-avatar-preview" id="modal-avatar" src="' + escapeHtml(s.userProfile.avatar || defaultAvatar(userName)) + '"/>' +
        '<div style="text-align:center"><label class="compose-file-btn" for="modal-avatar-file" style="display:inline-block;padding:6px 14px;font-size:12px">เปลี่ยนรูป</label></div>' +
        '<input type="file" id="modal-avatar-file" accept="image/*" style="display:none"/>' +
        '<label>ชื่อผู้ใช้ (username) *</label>' +
        '<input type="text" id="modal-username" value="' + escapeHtml(currentUsername) + '" placeholder="your_username"/>' +
        '<div style="font-size:11px;color:#737373;margin-top:2px">ตัวอักษร/ตัวเลข/_ เท่านั้น</div>' +
        '<label>ชื่อที่แสดง</label>' +
        '<input type="text" id="modal-displayname" value="' + escapeHtml(currentDisplayName) + '"/>' +
        '<label>ไบโอ</label>' +
        '<textarea id="modal-bio" rows="3" placeholder="เขียนอะไรเกี่ยวกับตัวคุณ...">' + escapeHtml(s.userProfile.bio || "") + '</textarea>' +
        '<div class="modal-actions">' +
            '<button class="cancel" id="modal-cancel">ยกเลิก</button>' +
            '<button class="confirm" id="modal-save">บันทึก</button>' +
        '</div>'
    );

    let newAvatar = null;
    modal.querySelector("#modal-avatar-file").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { toast("รูปใหญ่เกิน 2MB"); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            newAvatar = ev.target.result;
            modal.querySelector("#modal-avatar").src = newAvatar;
        };
        reader.readAsDataURL(file);
    });
    modal.querySelector("#modal-cancel").addEventListener("click", closeModal);
    modal.querySelector("#modal-save").addEventListener("click", () => {
        const newUsername = modal.querySelector("#modal-username").value.trim();
        const cleaned = sanitizeUsername(newUsername);
        if (!cleaned) {
            toast("username ไม่ถูกต้อง");
            return;
        }
        s.userProfile.username = cleaned;
        s.userProfile.displayName = modal.querySelector("#modal-displayname").value.trim() || userName;
        s.userProfile.bio = modal.querySelector("#modal-bio").value.trim();
        if (newAvatar) s.userProfile.avatar = newAvatar;
        save();
        closeModal();
        renderMyProfile();
        toast("บันทึกโปรไฟล์แล้ว ✓");
    });
}

// ---------- Event hooks ----------
let lastProcessedMsgId = -1;
async function onMessageReceived() {
    try {
        const s = getSettings();
        const ctx = getContext();
        const chat = ctx.chat || [];
        if (chat.length === 0) return;
        const msgIdx = chat.length - 1;
        if (msgIdx === lastProcessedMsgId) return;
        lastProcessedMsgId = msgIdx;
        const msg = chat[msgIdx];
        if (!msg || msg.is_user || msg.is_system) return;
        if (!msg.name) return;

        // Always detect NPCs if enabled
        if (s.npcDetection) {
            detectNPCs(msg.mes || "").catch(() => {});
        }

        // Ensure profile for the main speaker
        ensureCharProfile(msg.name);

        // Maybe post
        if (s.autoPost && Math.random() < s.postChance) {
            maybeGeneratePost(msg.name, msg.mes || "").catch(() => {});
        }
    } catch (e) {
        log("onMessageReceived: " + e.message, true);
    }
}

function onChatChanged() {
    try {
        lastProcessedMsgId = -1;
        const name = getActiveCharacterName();
        if (name) ensureCharProfile(name);
        if (isPanelOpen()) renderCurrentTab();
    } catch {}
}

// ---------- Settings UI ----------
async function loadSettingsUI() {
    try {
        const html = await $.get(extensionFolderPath + "/settings.html");
        $("#extensions_settings2").append(html);
        log("Settings HTML loaded");

        const s = getSettings();
        $("#instachar-toggle-icon").prop("checked", s.iconVisible);
        $("#instachar-toggle-autopost").prop("checked", s.autoPost);
        $("#instachar-toggle-ambient").prop("checked", s.ambientEnabled);
        $("#instachar-toggle-npc").prop("checked", s.npcDetection);
        $("#instachar-art-style").val(s.artStyle);
        $("#instachar-chance-slider").val(Math.round(s.postChance * 100));
        $("#instachar-chance-val").text(Math.round(s.postChance * 100) + "%");
        $("#instachar-debug-log").text(debugLog.slice(-12).join("\n"));
    } catch (e) {
        log("loadSettingsUI: " + e.message, true);
    }
}

function attachDelegation() {
    $(document).off(".instachar")
        .on("change.instachar", "#instachar-toggle-icon", function () {
            getSettings().iconVisible = $(this).prop("checked");
            save();
            setFloaterVisible(getSettings().iconVisible);
        })
        .on("change.instachar", "#instachar-toggle-autopost", function () {
            getSettings().autoPost = $(this).prop("checked");
            save();
        })
        .on("change.instachar", "#instachar-toggle-ambient", function () {
            const enabled = $(this).prop("checked");
            getSettings().ambientEnabled = enabled;
            save();
            if (enabled) startAmbientTimer(); else stopAmbientTimer();
        })
        .on("change.instachar", "#instachar-toggle-npc", function () {
            getSettings().npcDetection = $(this).prop("checked");
            save();
        })
        .on("change.instachar", "#instachar-art-style", function () {
            getSettings().artStyle = $(this).val();
            save();
        })
        .on("input.instachar", "#instachar-chance-slider", function () {
            const v = parseInt($(this).val());
            getSettings().postChance = v / 100;
            $("#instachar-chance-val").text(v + "%");
            save();
        })
        .on("click.instachar", "#instachar-open-btn", openPanel)
        .on("click.instachar", "#instachar-find-btn", function () {
            if (!shadowRoot) { alert("UI not mounted"); return; }
            const el = shadowRoot.getElementById("floater");
            if (!el) { alert("Icon missing"); return; }
            el.classList.add("flash");
            setTimeout(() => el.classList.remove("flash"), 3000);
        })
        .on("click.instachar", "#instachar-reset-pos-btn", function () {
            getSettings().iconPos = null;
            save();
            mountUI();
            toast("รีเซ็ตตำแหน่งไอคอนแล้ว");
        })
        .on("click.instachar", "#instachar-reset-chat-btn", function () {
            if (!confirm("ลบข้อมูล IG ของแชทนี้? (เฉพาะ chat ปัจจุบัน)")) return;
            const s = getSettings();
            const id = getCurrentChatId();
            delete s.chats[id];
            save();
            if (isPanelOpen()) renderCurrentTab();
            toast("ลบข้อมูลแชทนี้แล้ว");
        })
        .on("click.instachar", "#instachar-reset-all-btn", function () {
            if (!confirm("ลบข้อมูล InstaChar ทั้งหมด? (ย้อนไม่ได้)")) return;
            extension_settings[extensionName] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            save();
            if (isPanelOpen()) renderCurrentTab();
            toast("ลบข้อมูลทั้งหมดแล้ว");
        });
}

// ---------- Init ----------
jQuery(async () => {
    log("InstaChar v" + VERSION + " starting...");
    try {
        getSettings();
        attachDelegation();
        await loadSettingsUI();
        mountUI();
        if (eventSource && event_types) {
            try {
                if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
                if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
            } catch (e) { log("event bind: " + e.message, true); }
        }
        startAmbientTimer();
        log("Ready! 📱");
    } catch (e) {
        log("Init FAILED: " + e.message, true);
    }
});
