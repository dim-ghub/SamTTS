#!/usr/bin/env node
/**
 * Dusky SAM - Text to Speech using SAM with mpv playback
 * 
 * Generates speech using SAM TTS engine and plays audio via mpv.
 * 
 * Usage: 
 *   node index.js [options] [text...]
 *   node index.js --rofi (show rofi menu)
 * 
 * Options:
 *   --rofi, -r         Show rofi menu
 *   --sing, -s         Enable singing mode (use phonetic input)
 *   --phonetic, -p     Input is phonetic/text to be converted
 *   --speed, -S <n>    Speech/singing speed (default: 72)
 *   --pitch, -P <n>    Voice pitch (default: 64, range: 0-255)
 *   --throat, -G <n>   Throat resonance (default: 128)
 *   --mouth, -M <n>    Mouth resonance (default: 128)
 *   --json, -j <file>  Sing from JSON file (see star-spangled-banner format)
 * 
 * Voice parameters (via environment):
 *   SAM_SPEED  - Speech speed (default: 72)
 *   SAM_PITCH  - Voice pitch (default: 64)
 *   SAM_THROAT - Throat resonance (default: 128)
 *   SAM_MOUTH  - Mouth resonance (default: 128)
 * 
 * Singing mode example phonetic sounds:
 *   "ohohoh" - rising and falling tones
 *   "sehehehehehehehehehey" - sustained vowels
 *   Vowels: a, e, i, o, u
 *   Consonants help shape: dh (the), th, w, y, r, l, n, m, s, f, p, b, k, g
 */

import { spawn, execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import SamJs from 'sam-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Audio format constants (SAM outputs 8-bit unsigned PCM at 22050 Hz mono)
const SAMPLE_RATE = 22050;
const CHANNELS = 1;

// Colors
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

// Voice presets
const VOICE_PRESETS = {
    "Default (SAM)": { speed: 72, pitch: 64, throat: 128, mouth: 128 },
    "Elf": { speed: 72, pitch: 64, throat: 110, mouth: 160 },
    "Little Robot": { speed: 92, pitch: 60, throat: 190, mouth: 190 },
    "Stuffy Guy": { speed: 82, pitch: 72, throat: 110, mouth: 105 },
    "Little Old Lady": { speed: 82, pitch: 32, throat: 145, mouth: 145 },
    "Extra-Terrestrial": { speed: 100, pitch: 64, throat: 150, mouth: 200 }
};

// Aliases for presets
const VOICE_ALIASES = {
    "sam": "Default (SAM)",
    "default": "Default (SAM)",
    "robot": "Little Robot",
    "old lady": "Little Old Lady",
    "alien": "Extra-Terrestrial",
    "et": "Extra-Terrestrial",
    "elf": "Elf",
    "stuffy": "Stuffy Guy"
};

/**
 * Find preset by name or alias
 */
async function callOllama(text) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.5:0.8b',
        prompt: text,
        stream: false,
        think: false,
        system: 'You are Qwen. Give short, natural responses. Never say you are an AI or a chatbot.'
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Ollama responded with status ${response.status}`);
    }
    
    const data = await response.json();
    return data.response || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Ollama request timed out (60s). Is Ollama running with model qwen3.5:0.8b?');
    }
    throw new Error(`Failed to call Ollama: ${err.message}`);
  }
}

/**
 * Find preset by name or alias
 */
function findPreset(name) {
    if (!name) return null;
    if (VOICE_PRESETS[name]) return name;
    const alias = VOICE_ALIASES[name.toLowerCase()];
    return alias || null;
}

/**
 * Run rofi menu
 */
function rofiMenu(prompt, options, lines = 10) {
    const choice = execSync(
        `echo -e "${options.join('\\n')}" | rofi -dmenu -i -p "${prompt}" -lines ${lines} -width 40`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return choice;
}

/**
 * Get text via rofi prompt
 */
function rofiPrompt(prompt) {
    return execSync(
        `rofi -dmenu -i -p "${prompt}" -lines 1 -width 50`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const DEFAULT_SPEED = 72;
  const DEFAULT_PITCH = 64;
  const DEFAULT_THROAT = 128;
  const DEFAULT_MOUTH = 128;
  
  const args = {
    text: [],
    sing: false,
    phonetic: false,
    rofi: false,
    vc: false,
    roblox: false,
    preset: null,
    speed: parseInt(process.env.SAM_SPEED || String(DEFAULT_SPEED)),
    pitch: parseInt(process.env.SAM_PITCH || String(DEFAULT_PITCH)),
    throat: parseInt(process.env.SAM_THROAT || String(DEFAULT_THROAT)),
    mouth: parseInt(process.env.SAM_MOUTH || String(DEFAULT_MOUTH)),
    jsonFile: null,
    ollama: false
  };

  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--rofi' || arg === '-r') {
      args.rofi = true;
    } else if (arg === '--vc') {
      args.vc = true;
    } else if (arg === '--roblox') {
      args.roblox = true;
    } else if (arg === '--sing' || arg === '-s') {
      args.sing = true;
    } else if (arg === '--phonetic' || arg === '-p') {
      args.phonetic = true;
    } else if (arg === '--preset' || arg === '--voice') {
      args.preset = argv[++i];
    } else if (arg === '--speed' || arg === '-S') {
      args.speed = parseInt(argv[++i]) || DEFAULT_SPEED;
    } else if (arg === '--pitch' || arg === '-P') {
      args.pitch = parseInt(argv[++i]) || DEFAULT_PITCH;
    } else if (arg === '--throat' || arg === '-G') {
      args.throat = parseInt(argv[++i]) || DEFAULT_THROAT;
    } else if (arg === '--mouth' || arg === '-M') {
      args.mouth = parseInt(argv[++i]) || DEFAULT_MOUTH;
    } else if (arg === '--json' || arg === '-j') {
      args.jsonFile = argv[++i];
    } else if (arg === '--ollama' || arg === '-o') {
      args.ollama = true;
    } else if (arg === '--help' || arg === '-h') {
      if (argv[i + 1] === 'sing') {
        printPhoneticsHelp();
        process.exit(0);
      }
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      args.text.push(arg);
    }
  }
  
  // Check if preset was specified
  const presetName = findPreset(args.preset);
  if (presetName) {
    const preset = VOICE_PRESETS[presetName];
    args.speed = preset.speed;
    args.pitch = preset.pitch;
    args.throat = preset.throat;
    args.mouth = preset.mouth;
    args.preset = presetName;
  }

  return args;
}

const PHONETICS_REFERENCE = {
  VOWELS: [
    { phoneme: 'IY', sound: 'ee as in "beat"' },
    { phoneme: 'IH', sound: 'i as in "bit"' },
    { phoneme: 'EH', sound: 'e as in "bet"' },
    { phoneme: 'AE', sound: 'a as in "bat"' },
    { phoneme: 'AA', sound: 'o as in "bot" (or a as in "bat" with mouth open)' },
    { phoneme: 'AH', sound: 'u as in "but"' },
    { phoneme: 'AO', sound: 'aw as in "bought"' },
    { phoneme: 'UH', sound: 'oo as in "book"' },
    { phoneme: 'UX', sound: 'oo as in "boot"' },
    { phoneme: 'OH', sound: 'o as in "boat"' },
    { phoneme: 'ER', sound: 'er as in "bird"' },
    { phoneme: 'AX', sound: 'a as in "about"' },
    { phoneme: 'IX', sound: 'e as in "roses" (unstressed)' },
  ],
  DIPHTHONGS: [
    { phoneme: 'EY', sound: 'ay as in "bait"' },
    { phoneme: 'AY', sound: 'i as in "bite"' },
    { phoneme: 'OY', sound: 'oy as in "boy"' },
    { phoneme: 'AW', sound: 'ow as in "bout"' },
    { phoneme: 'OW', sound: 'ow as in "boat"' },
    { phoneme: 'UW', sound: 'oo as in "boot"' },
  ],
  CONSONANTS: [
    { phoneme: 'R*', sound: 'r as in "red"' },
    { phoneme: 'L*', sound: 'l as in "led"' },
    { phoneme: 'W*', sound: 'w as in "wet"' },
    { phoneme: 'Y*', sound: 'y as in "yes"' },
    { phoneme: 'M*', sound: 'm as in "men"' },
    { phoneme: 'N*', sound: 'n as in "net"' },
    { phoneme: 'NX', sound: 'ng as in "sing"' },
    { phoneme: 'B*', sound: 'b as in "bed"' },
    { phoneme: 'D*', sound: 'd as in "dead"' },
    { phoneme: 'G*', sound: 'g as in "get"' },
    { phoneme: 'P*', sound: 'p as in "pet"' },
    { phoneme: 'T*', sound: 't as in "ten"' },
    { phoneme: 'K*', sound: 'k as in "kit"' },
    { phoneme: 'KX', sound: 'k as in "kit" (simpler)' },
    { phoneme: 'GX', sound: 'g as in "get" (simpler)' },
    { phoneme: 'S*', sound: 's as in "set"' },
    { phoneme: 'Z*', sound: 'z as in "zoo"' },
    { phoneme: 'V*', sound: 'v as in "vet"' },
    { phoneme: 'F*', sound: 'f as in "fed"' },
    { phoneme: 'TH', sound: 'th as in "thin"' },
    { phoneme: 'DH', sound: 'th as in "the"' },
    { phoneme: 'SH', sound: 'sh as in "shed"' },
    { phoneme: 'ZH', sound: 's as in "measure"' },
    { phoneme: 'CH', sound: 'ch as in "check"' },
    { phoneme: 'J*', sound: 'j as in "jet"' },
    { phoneme: 'Q*', sound: 'glottal stop (catch in "cat")' },
    { phoneme: 'DX', sound: 'd as in "butter"' },
    { phoneme: '/H', sound: 'h as in "hat"' },
    { phoneme: '/X', sound: 'ch as in "ich"' },
    { phoneme: 'WH', sound: 'wh as in "what"' },
  ],
  NASAL_VOWELS: [
    { phoneme: 'UL', sound: 'ul as in "urn" or "bull"' },
    { phoneme: 'UM', sound: 'um as in "urn" (nasal)' },
    { phoneme: 'UN', sound: 'un as in "under" (nasal)' },
  ],
  SPECIAL: [
    { phoneme: 'RX', sound: 'rounded r (smooth transition)' },
    { phoneme: 'LX', sound: 'l followed by uh sound' },
    { phoneme: 'WX', sound: 'w followed by rounded vowel' },
    { phoneme: 'YX', sound: 'y sound transition' },
  ],
  STRESS: [
    { phoneme: '*', sound: 'stress marker (add before phoneme: *IY for stressed "beat")' },
  ],
  PUNCTUATION: [
    { phoneme: '.', sound: 'period - short pause' },
    { phoneme: ',', sound: 'comma - brief pause' },
    { phoneme: '?', sound: 'question - rising intonation' },
    { phoneme: '-', sound: 'hyphen - smoother transition' },
    { phoneme: ' ', sound: 'space - word boundary' },
  ]
};

function printPhoneticsHelp() {
  console.log(`
Dusky SAM - Phonetics Reference for Singing Mode

Usage:
  node index.js --sing --phonetic "kaeaeaeaeaen" --pitch 76

VOWELS (pure vowel sounds):
`);
  PHONETICS_REFERENCE.VOWELS.forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
DIPHTHONGS (gliding vowel sounds):
`);
  PHONETICS_REFERENCE.DIPHTHONGS.forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
CONSONANTS (use to shape syllables):
`);
  PHONETICS_REFERENCE.CONSONANTS.forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
NASAL VOWELS:
`);
  PHONETICS_REFERENCE.NASAL_VOWELS.forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
SPECIAL:
`);
  PHONETICS_REFERENCE.SPECIAL.forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
STRESS & PUNCTUATION:
`);
  [...PHONETICS_REFERENCE.STRESS, ...PHONETICS_REFERENCE.PUNCTUATION].forEach(p => console.log(`  ${p.phoneme.padEnd(4)} ${p.sound}`));

  console.log(`
SINGING TIPS:
  - Repeat vowels for sustained notes: "ohohoh", "sehehehehey"
  - Use consonants for percussive effects: "kaeaeaeaeaen", "tatatata"
  - Lower pitch (32-48) for deep male voice, higher (80-120) for high voice
  - Slow speed (20-50) for slower songs, faster (60-100) for upbeat
  - Combine vowels for transitions: "kaeiy" (from "a" to "ee")

EXAMPLES:
  node index.js --sing --pitch 64 "kaeaeaeaeaen"
  node index.js --sing --pitch 96 "ohohoh sehehehehey"
  node index.js --sing --pitch 48 --speed 40 "kaeaeaeaey iy iy iy"

For more help: node index.js --help
`);
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Dusky SAM - Text to Speech using SAM with mpv playback

Usage: 
  node index.js [options] [text...]     Speak text
  node index.js                         Show help
  node index.js --rofi                  Show rofi menu
  node index.js --json song.json        Sing from JSON file
  node index.js --vc "text"             Voice changer mode (route to mic)

Options:
  --rofi, -r           Show rofi menu (speak or sing with presets)
  --vc                 Voice changer mode (route audio to virtual mic)
  --roblox            Type text in Roblox chat (press /, type, enter)
  --preset, --voice <name>  Use preset voice (skips voice menu in rofi mode)
  --sing, -s           Enable singing mode (use phonetic input)
  --phonetic, -p       Input is phonetic (skip text-to-phoneme conversion)
  --speed, -S <n>      Speech speed (default: 72, lower = slower)
  --pitch, -P <n>      Voice pitch (default: 64, range: 32-96 good for singing)
  --throat, -G <n>     Throat resonance (default: 128)
  --mouth, -M <n>      Mouth resonance (default: 128)
  --json, -j <file>    Sing from JSON file (array of {text, speed, pitch} objects)
  --ollama, -o         Send input text to Ollama and use response for TTS
  --help, -h           Show this help message
  --help sing          Show phonetics reference for singing mode

Environment variables (override CLI args):
  SAM_SPEED, SAM_PITCH, SAM_THROAT, SAM_MOUTH

Singing examples:
  node index.js --sing --pitch 76 "ohohoh"
  node index.js --sing --pitch 96 "sehehehehehehehehehey"
  node index.js --help sing      Show all available phonetics
   
JSON song format:
  [
    {"text": "ohohoh", "speed": 40, "pitch": 76},
    {"text": "kaeaeaeaeaeaeaeaeaen", "speed": 40, "pitch": 64}
  ]

Voice presets:
  Elf:        SAM_PITCH=64 SAM_SPEED=72 SAM_THROAT=110 SAM_MOUTH=160
  Robot:      SAM_PITCH=60 SAM_SPEED=92 SAM_THROAT=190 SAM_MOUTH=190
  Old Lady:   SAM_PITCH=32 SAM_SPEED=82 SAM_THROAT=145 SAM_MOUTH=145
`);
}

/**
 * Convert 8-bit unsigned PCM to float32
 */
function u8ToFloat32(buffer) {
  const floatBuffer = Buffer.alloc(buffer.length * 4);
  for (let i = 0; i < buffer.length; i++) {
    // Convert 0-255 to -1.0 to 1.0
    const float = (buffer[i] - 128) / 128.0;
    floatBuffer.writeFloatLE(float, i * 4);
  }
  return floatBuffer;
}

/**
 * Spawn mpv with raw audio demuxer
 */
function spawnMpv() {
  const mpv = spawn('mpv', [
    '--no-terminal',
    '--force-window',
    '--title=samtts',
    '--x11-name=samtts',
    '--wayland-app-id=samtts',
    '--keep-open=no',
    '--demuxer=rawaudio',
    `--demuxer-rawaudio-rate=${SAMPLE_RATE}`,
    '--demuxer-rawaudio-channels=1',
    '--demuxer-rawaudio-format=float',
    '-'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Handle mpv stderr (quiet)
  mpv.stderr.on('data', () => {});

  return mpv;
}

/**
 * Speak text via mpv
 */
async function speakViaMpv(text, options) {
  const sam = new SamJs({
    speed: options.speed,
    pitch: options.pitch,
    throat: options.throat,
    mouth: options.mouth,
    singmode: options.sing
  });

  // Generate audio buffer
  let audioBuffer;
  if (options.phonetic || options.sing) {
    // Raw phoneme input
    audioBuffer = sam.buf8(text, true);
  } else {
    // Text input (convert to phonemes)
    audioBuffer = sam.buf8(text, false);
  }
  
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('Failed to generate audio');
  }

  return audioBuffer;
}

/**
 * Play audio buffer via mpv
 */
async function playAudio(audioBuffer) {
  return new Promise((resolve, reject) => {
    const mpv = spawnMpv();
    let resolved = false;
    
    mpv.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`mpv exited with code ${code}`));
        }
      }
    });
    
    mpv.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`mpv error: ${err.message}`));
      }
    });
    
    // Convert 8-bit PCM to float32 and write to mpv stdin
    const floatBuffer = u8ToFloat32(Buffer.from(audioBuffer));
    
    // Prepend 1 second of silence
    const silenceBuffer = Buffer.alloc(SAMPLE_RATE * 4); // 1 second at 22050 Hz in float32
    const combinedBuffer = Buffer.concat([silenceBuffer, floatBuffer]);
    
    mpv.stdin.write(combinedBuffer);
    mpv.stdin.end();
  });
}

/**
 * Type text in Roblox chat
 */
async function typeInRoblox(text) {
  // Press / to open chat
  console.log(`${YELLOW}▸ Typing in Roblox chat...${RESET}`);
  execSync('wtype /');
  
  // Wait 0.3 seconds
  await new Promise(r => setTimeout(r, 300));
  
  // Type the text
  execSync(`wtype "${text}"`);
  
  // Small delay
  await new Promise(r => setTimeout(r, 100));
  
  // Press Enter
  execSync('wtype -k Return');
}

/**
 * Sing from JSON file
 */
async function singFromJson(jsonFile, vc = false) {
  console.log(`${CYAN}▸ Loading song from: ${jsonFile}${RESET}`);
  
  let songData;
  try {
    const content = readFileSync(jsonFile, 'utf-8');
    songData = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to read JSON file: ${err.message}`);
  }

  if (!Array.isArray(songData)) {
    throw new Error('JSON file must contain an array of song lines');
  }

  console.log(`${GREEN}▸ Song has ${songData.length} lines${RESET}`);

  const routingScript = `${process.env.HOME}/user_scripts/audio/router/audio_routing_output_to_mic.py`;
  
  if (vc) {
    console.log(`${YELLOW}▸ Starting audio routing...${RESET}`);
    spawn(routingScript, ['--daemon', 'mpv'], { stdio: 'ignore', detached: true });
    await new Promise(r => setTimeout(r, 500));
  }

  const mpv = spawnMpv();
  let resolved = false;
  let currentLine = 0;

  const processNextLine = () => {
    if (currentLine >= songData.length) {
      // End of song
      if (!resolved) {
        mpv.stdin.end();
      }
      return;
    }

    // Add 1 second silence before first line
    if (currentLine === 0) {
      const silenceBuffer = Buffer.alloc(SAMPLE_RATE * 4); // 1 second at 22050 Hz in float32
      try {
        mpv.stdin.write(silenceBuffer);
      } catch (err) {
        console.error(`${RED}✗ Write error: ${err.message}${RESET}`);
        return;
      }
    }

    const line = songData[currentLine++];
    const text = line.text;
    const speed = line.speed || 72;
    const pitch = line.pitch || 64;

    const displayText = text.length > 40 ? text.substring(0, 40) + '...' : text;
    console.log(`${YELLOW}  Line ${currentLine}/${songData.length}:${RESET} pitch=${pitch} "${displayText}"`);

    const sam = new SamJs({
      speed: speed,
      pitch: pitch,
      throat: 128,
      mouth: 128,
      singmode: true
    });

    const audioBuffer = sam.buf8(text, true);
    
    if (audioBuffer && audioBuffer.length > 0) {
      const floatBuffer = u8ToFloat32(Buffer.from(audioBuffer));
      try {
        mpv.stdin.write(floatBuffer);
      } catch (err) {
        console.error(`${RED}✗ Write error: ${err.message}${RESET}`);
        return;
      }
    }

    // Small delay between lines for effect
    setTimeout(processNextLine, 50);
  };

  return new Promise((resolve, reject) => {
    mpv.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        
        if (vc) {
          // Wait for mpv to finish
          while (true) {
            try {
              const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
              if (!result.trim()) break;
            } catch (e) { break; }
            setTimeout(() => {}, 1000);
          }
          execSync(`${routingScript} --stop`, { shell: true });
        }
        
        console.log(`${GREEN}▸ Song complete!${RESET}`);
        resolve();
      }
    });
    
    mpv.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`mpv error: ${err.message}`));
      }
    });

    processNextLine();
  });
}

/**
 * Get list of JSON song files in songs folder
 */
function getSongFiles() {
  const songsDir = join(__dirname, 'songs');
  try {
    const files = readdirSync(songsDir);
    return files.filter(f => f.endsWith('.json')).sort();
  } catch (err) {
    return [];
  }
}

/**
 * Handle rofi menu mode
 */
async function handleRofi(args) {
  // Main menu
  const mode = rofiMenu('Dusky SAM:', ['Speak', 'Sing']);
  
  if (mode === 'Speak') {
    // Always show text input prompt
    let text = rofiPrompt('Enter text to speak:');
    
    if (!text) return;
    
    // Call ollama if flag is set
    if (args.ollama) {
      console.log(`${CYAN}▸ Calling Ollama...${RESET}`);
      const ollamaResponse = await callOllama(text);
      text = ollamaResponse.replace(/[^\x00-\x7F]/g, '').trim();
    }
    
    let voice;
    
    // Check if preset was specified via CLI
    if (args.preset && VOICE_PRESETS[args.preset]) {
      const preset = VOICE_PRESETS[args.preset];
      voice = {
        speed: preset.speed,
        pitch: preset.pitch,
        throat: preset.throat,
        mouth: preset.mouth,
        sing: false,
        phonetic: false
      };
    } else {
      // Select voice preset
      const presetNames = Object.keys(VOICE_PRESETS);
      const preset = rofiMenu('Select voice:', presetNames, presetNames.length);
      
      if (!preset) return;
      
      voice = {
        speed: VOICE_PRESETS[preset].speed,
        pitch: VOICE_PRESETS[preset].pitch,
        throat: VOICE_PRESETS[preset].throat,
        mouth: VOICE_PRESETS[preset].mouth,
        sing: false,
        phonetic: false
      };
    }
    
    console.log(`${CYAN}▸ Speaking:${RESET} "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
    
    const audioBuffer = await speakViaMpv(text, voice);
    
    const duration = (audioBuffer.length / SAMPLE_RATE).toFixed(2);
    console.log(`${GREEN}▸ Generated ${audioBuffer.length} samples (~${duration}s)${RESET}`);
    
    if (args.vc || args.roblox) {
      // Start mpv first (with VC routing if enabled)
      if (args.vc) {
        console.log(`${YELLOW}▸ Starting audio routing...${RESET}`);
        const routingScript = `${process.env.HOME}/user_scripts/audio/router/audio_routing_output_to_mic.py`;
        spawn(routingScript, ['--daemon', 'mpv'], { stdio: 'ignore', detached: true });
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Start mpv
      const mpv = spawnMpv();
      
      // Write audio to mpv
      const floatBuffer = u8ToFloat32(Buffer.from(audioBuffer));
      const silenceBuffer = Buffer.alloc(SAMPLE_RATE * 4);
      const combinedBuffer = Buffer.concat([silenceBuffer, floatBuffer]);
      
      mpv.stdin.write(combinedBuffer);
      mpv.stdin.end();
      
      // Wait for mpv to start
      while (true) {
        try {
          const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          if (result.trim()) break;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
      }
      
      // Small delay for audio to start playing
      await new Promise(r => setTimeout(r, 200));
      
      // Type in Roblox (while audio is playing)
      if (args.roblox) {
        await typeInRoblox(text);
      }
      
      // Wait for mpv to finish
      while (true) {
        try {
          const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          if (!result.trim()) break;
        } catch (e) { break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      
      if (args.vc) {
        const routingScript = `${process.env.HOME}/user_scripts/audio/router/audio_routing_output_to_mic.py`;
        execSync(`${routingScript} --stop`, { shell: true });
      }
      console.log(`${GREEN}▸ Done!${RESET}`);
    } else {
      // Normal playback
      console.log(`${YELLOW}▸ Playing via mpv...${RESET}`);
      await playAudio(audioBuffer);
      console.log(`${GREEN}▸ Done!${RESET}`);
    }
    
  } else if (mode === 'Sing') {
    // Select song
    const songs = getSongFiles();
    
    if (songs.length === 0) {
      console.error(`${RED}✗ No song files found${RESET}`);
      return;
    }
    
    const displayNames = songs.map(s => s.replace('.json', ''));
    const choice = rofiMenu('Select song:', displayNames, displayNames.length);
    
    if (!choice) return;
    
    const songFile = join(__dirname, 'songs', choice + '.json');
    
    // Sing with optional VC mode
    await singFromJson(songFile, args.vc);
  }
}

/**
 * Handle voice changer mode - route audio to virtual mic
 */
async function handleVoiceChanger(text, voice = null) {
  const routingScript = `${process.env.HOME}/user_scripts/audio/router/audio_routing_output_to_mic.py`;
  
  console.log(`${CYAN}▸ Voice Changer Mode${RESET}`);
  console.log(`${CYAN}▸ Speaking:${RESET} "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
  
  // Copy to clipboard
  execSync(`echo -n "${text.replace(/"/g, '\\"')}" | wl-copy`, { shell: true });
  
  // Start audio routing
  console.log(`${YELLOW}▸ Starting audio routing...${RESET}`);
  spawn(routingScript, ['--daemon', 'mpv'], { stdio: 'ignore', detached: true });
  
  // Small delay to let routing start
  await new Promise(r => setTimeout(r, 500));
  
  // Generate audio
  const audioOptions = voice || {
    speed: parseInt(process.env.SAM_SPEED || '72'),
    pitch: parseInt(process.env.SAM_PITCH || '64'),
    throat: parseInt(process.env.SAM_THROAT || '128'),
    mouth: parseInt(process.env.SAM_MOUTH || '128'),
    sing: false,
    phonetic: false
  };
  const audioBuffer = await speakViaMpv(text, audioOptions);
  
  // Prepare audio with silence
  const silenceBuffer = Buffer.alloc(SAMPLE_RATE * 4);
  const floatBuffer = u8ToFloat32(Buffer.from(audioBuffer));
  const combinedBuffer = Buffer.concat([silenceBuffer, floatBuffer]);
  
  // Spawn mpv to play audio (routing captures it)
  const mpv = spawn('mpv', [
    '--no-terminal',
    '--force-window',
    '--title=samtts',
    '--x11-name=samtts',
    '--wayland-app-id=samtts',
    '--keep-open=no',
    '--demuxer=rawaudio',
    `--demuxer-rawaudio-rate=${SAMPLE_RATE}`,
    '--demuxer-rawaudio-channels=1',
    '--demuxer-rawaudio-format=float',
    '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  
  mpv.stdin.write(combinedBuffer);
  mpv.stdin.end();
  
  // Wait for mpv to start
  while (true) {
    try {
      const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (result.trim()) break;
    } catch (e) {
      // pgrep returns non-zero when no process found
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Wait for mpv to finish
  await new Promise((resolve) => {
    mpv.on('close', resolve);
  });
  
  // Extra wait to ensure routing completes
  await new Promise(r => setTimeout(r, 500));
  
  // Stop audio routing
  console.log(`${YELLOW}▸ Stopping audio routing...${RESET}`);
  execSync(`${routingScript} --stop`, { shell: true });
  
  console.log(`${GREEN}▸ Done!${RESET}`);
}

/**
 * Main function
 */
async function main() {
  try {
    const args = parseArgs();

    // Handle rofi menu mode
    if (args.rofi) {
      await handleRofi(args);
      return;
    }

    // Handle voice changer mode (standalone)
    if (args.vc && args.text.length > 0) {
      await handleVoiceChanger(args.text.join(' '));
      return;
    }

    // Handle JSON song file
    if (args.jsonFile) {
      const songFile = join(__dirname, 'songs', args.jsonFile);
      await singFromJson(songFile);
      return;
    }

    // Get text from command line arguments
    let text;
    
    if (args.text.length > 0) {
      text = args.text.join(' ');
    } else {
      console.error(`${RED}✗ Error:${RESET} No text provided. Use: node index.js "your text"`);
      process.exit(1);
    }

    // Call ollama if flag is set
    let chatText = text;
    if (args.ollama) {
      console.log(`${CYAN}▸ Calling Ollama...${RESET}`);
      const ollamaResponse = await callOllama(text);
      
      if (!ollamaResponse.trim()) {
        console.error(`${RED}✗ Error:${RESET} Ollama returned empty response`);
        process.exit(1);
      }
      
      text = ollamaResponse.replace(/[^\x00-\x7F]/g, '').trim();
      
      const cleanedResponse = ollamaResponse.replace(/[^\x00-\x7F]/g, '').trim();
      text = cleanedResponse;
      
      if (args.roblox && ollamaResponse.length > 200) {
        chatText = '[response exceeds 200 characters, truncated]';
        console.log(`${YELLOW}▸ Response too long for Roblox, using truncation message${RESET}`);
      } else {
        chatText = cleanedResponse;
      }
    }

    // Display what we're speaking
    const displayText = text.length > 80 ? text.substring(0, 80) + '...' : text;
    const mode = args.sing ? 'Sing' : 'Speak';
    console.log(`${CYAN}▸ ${mode}:${RESET} "${displayText}"`);
    
    const audioBuffer = await speakViaMpv(text, {
      speed: args.speed,
      pitch: args.pitch,
      throat: args.throat,
      mouth: args.mouth,
      sing: args.sing,
      phonetic: args.phonetic
    });
    
    const duration = (audioBuffer.length / SAMPLE_RATE).toFixed(2);
    console.log(`${GREEN}▸ Generated ${audioBuffer.length} samples (~${duration}s)${RESET}`);
    
    if (args.roblox) {
      // Start mpv first, then type in Roblox
      console.log(`${YELLOW}▸ Starting audio...${RESET}`);
      
      const mpv = spawnMpv();
      
      // Write audio to mpv
      const floatBuffer = u8ToFloat32(Buffer.from(audioBuffer));
      const silenceBuffer = Buffer.alloc(SAMPLE_RATE * 4);
      const combinedBuffer = Buffer.concat([silenceBuffer, floatBuffer]);
      
      mpv.stdin.write(combinedBuffer);
      mpv.stdin.end();
      
      // Wait for mpv to start
      while (true) {
        try {
          const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          if (result.trim()) break;
        } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
      }
      
      // Small delay for audio to start playing
      await new Promise(r => setTimeout(r, 200));
      
      // Type in Roblox (while audio is playing)
      await typeInRoblox(chatText);
      
      // Wait for mpv to finish
      while (true) {
        try {
          const result = execSync('pgrep -x mpv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          if (!result.trim()) break;
        } catch (e) { break; }
        await new Promise(r => setTimeout(r, 1000));
      }
      
      console.log(`${GREEN}▸ Done!${RESET}`);
    } else {
      // Normal playback
      console.log(`${YELLOW}▸ Playing via mpv...${RESET}`);
      await playAudio(audioBuffer);
      console.log(`${GREEN}▸ Done!${RESET}`);
    }
    
  } catch (err) {
    console.error(`${RED}✗ Error:${RESET} ${err.message}`);
    process.exit(1);
  }
}

main();
