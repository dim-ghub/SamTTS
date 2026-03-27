#!/usr/bin/env node
/**
 * MIDI to SAM Song Template Converter
 * 
 * Converts MIDI files to SAM TTS singing templates with placeholder phonemes.
 * 
 * Usage:
 *   node midi_to_song.js [options] <midi_file>
 * 
 * Options:
 *   --output, -o <file>    Output JSON file (default: <name>.json in songs/)
 *   --speed, -s <n>        Base speed (default: 50, lower=slower)
 *   --tempo, -t <n>        Override tempo (BPM, auto-detect if not set)
 *   --min-pitch, -m <n>    Minimum MIDI pitch (default: auto from file)
 *   --max-pitch, -M <n>    Maximum MIDI pitch (default: auto from file)
 *   --pitch-range <min>-<max>  MIDI pitch range to include
 *   --verbose, -v          Verbose output
 *   --dry-run              Show output without writing file
 *   --sustain, -S <n>      Sustain percentage 0-100 (default: 70)
 *   --phoneme-type <type>  Phoneme style: vowels, consonants, mixed (default: mixed)
 *   --syllables            Use syllable mode (single note per phoneme group)
 *   --lyrics               Extract and use lyrics from MIDI if available
 * 
 * Note: Lower pitch values in SAM = higher actual pitch!
 *   SAM pitch 32-40 = high range
 *   SAM pitch 64 = medium
 *   SAM pitch 80-96 = low range
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI Colors
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';

// SAM pitch range constants (lower = higher pitch)
const SAM_MIN_PITCH = 32;
const SAM_MAX_PITCH = 96;
const SAM_DEFAULT_PITCH = 64;

// Syllable patterns for shorter notes
const SYLLABLE_PATTERNS = [
  'ka', 'ta', 'pa', 'ba', 'da', 'ga',
  'ki', 'ti', 'pi', 'bi', 'di', 'gi',
  'la', 'na', 'ma', 'ra', 'sa', 'za',
  'vu', 'fu', 'su', 'zu', 'lu', 'nu'
];

// Sustained vowel patterns
const SUSTAIN_PATTERNS = {
  short: ['aa', 'iy', 'oh', 'uh'],
  medium: ['kaa', 'ohoh', 'miy', 'maa'],
  long: ['kaaaa', 'ohohoh', 'miyiy', 'maaaa'],
  verylong: ['kaaaaaa', 'ohohohoh', 'miyiyiy', 'maaaaaa']
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = {
    midiFile: null,
    output: null,
    speed: 50,
    tempo: null,
    minPitch: null,
    maxPitch: null,
    verbose: false,
    dryRun: false,
    sustain: 70,
    phonemeType: 'mixed',
    syllableMode: false,
    useLyrics: false
  };

  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--speed' || arg === '-s') {
      args.speed = parseInt(argv[++i]) || 40;
    } else if (arg === '--tempo' || arg === '-t') {
      args.tempo = parseInt(argv[++i]) || null;
    } else if (arg === '--min-pitch' || arg === '-m') {
      args.minPitch = parseInt(argv[++i]) || null;
    } else if (arg === '--max-pitch' || arg === '-M') {
      args.maxPitch = parseInt(argv[++i]) || null;
    } else if (arg === '--pitch-range') {
      const range = argv[++i].split('-').map(Number);
      args.minPitch = range[0];
      args.maxPitch = range[1] || range[0] + 24;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--sustain' || arg === '-S') {
      args.sustain = Math.min(100, Math.max(0, parseInt(argv[++i]) || 70));
    } else if (arg === '--phoneme-type') {
      const type = argv[++i].toLowerCase();
      if (['vowels', 'consonants', 'mixed'].includes(type)) {
        args.phonemeType = type;
      }
    } else if (arg === '--syllables') {
      args.syllableMode = true;
    } else if (arg === '--lyrics') {
      args.useLyrics = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      args.midiFile = arg;
    }
  }

  return args;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${BOLD}MIDI to SAM Song Template Converter${RESET}

${CYAN}Usage:${RESET}
  node midi_to_song.js [options] <midi_file>

${CYAN}Options:${RESET}
  --output, -o <file>    Output JSON file (default: <name>.json in songs/)
  --speed, -s <n>        Base speed (default: 50, lower=slower)
  --tempo, -t <n>        Override tempo (BPM, auto-detect if not set)
  --min-pitch, -m <n>    Minimum MIDI pitch to include (default: auto)
  --max-pitch, -M <n>    Maximum MIDI pitch to include (default: auto)
  --pitch-range <min>-<max>  MIDI pitch range to include
  --sustain, -S <n>      Sustain percentage 0-100 (default: 70)
  --phoneme-type <type>  Phoneme style: vowels, consonants, mixed (default: mixed)
  --syllables            Use single syllable mode for all notes
  --lyrics               Extract and use lyrics from MIDI if available
  --verbose, -v          Verbose output
  --dry-run              Show output without writing file
  --help, -h             Show this help message

${CYAN}Pitch Mapping:${RESET}
  Note: Lower SAM pitch = Higher actual pitch!
  - SAM pitch 32-40 = High range (female soprano)
  - SAM pitch 48-64 = Medium range (male tenor)
  - SAM pitch 72-96 = Low range (male bass)

${CYAN}Examples:${RESET}
  node midi_to_song.js song.mid
  node midi_to_song.js -o my_song.json -s 45 song.mid
  node midi_to_song.js -t 120 --pitch-range 48-72 song.mid
  node midi_to_song.js --syllables --verbose song.mid
`);
}

/**
 * Read variable length quantity from Uint8Array
 */
function readVariableLength(data, offset) {
  let value = 0;
  let bytesRead = 0;
  
  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    bytesRead++;
    value = (value << 7) | (byte & 0x7F);
    if ((byte & 0x80) === 0) break;
  }
  
  return { value, bytesRead };
}

/**
 * Parse MIDI file using a clean, robust parser
 */
function parseMidi(buffer) {
  // Work with Uint8Array for easier byte manipulation
  const data = new Uint8Array(buffer);
  
  // Verify header
  const headerTag = String.fromCharCode(data[0], data[1], data[2], data[3]);
  if (headerTag !== 'MThd') {
    throw new Error('Invalid MIDI file: missing MThd header');
  }
  
  const headerLength = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
  const format = (data[8] << 8) | data[9];
  const numTracks = (data[10] << 8) | data[11];
  const division = (data[12] << 8) | data[13];
  
  // Handle division (ticks per quarter note)
  const ticksPerQuarterNote = division;
  
  const tracks = [];
  let globalTempo = 120; // Default BPM
  let currentOffset = 14; // After header
  
  // Parse each track
  for (let trackNum = 0; trackNum < numTracks; trackNum++) {
    if (currentOffset + 8 > data.length) break;
    
    const trackTag = String.fromCharCode(
      data[currentOffset], data[currentOffset + 1],
      data[currentOffset + 2], data[currentOffset + 3]
    );
    
    if (trackTag !== 'MTrk') {
      currentOffset++;
      continue;
    }
    
    const trackLength = 
      (data[currentOffset + 4] << 24) |
      (data[currentOffset + 5] << 16) |
      (data[currentOffset + 6] << 8) |
      data[currentOffset + 7];
    
    currentOffset += 8;
    const trackEnd = currentOffset + trackLength;
    
    const events = [];
    let absoluteTick = 0;
    let runningStatus = 0;
    
    while (currentOffset < trackEnd) {
      // Read delta time
      const deltaResult = readVariableLength(data, currentOffset);
      const delta = deltaResult.value;
      currentOffset += deltaResult.bytesRead;
      absoluteTick += delta;
      
      // Read status byte
      let status = data[currentOffset];
      let isRunningStatus = false;
      
      if (status < 0x80) {
        // Running status - use last status
        if (runningStatus === 0) {
          // No running status, skip this byte
          currentOffset++;
          continue;
        }
        isRunningStatus = true;
      } else {
        // New status byte
        currentOffset++;
        // Real-time messages (0xF1-0xF7) don't use running status
        if (status < 0xF0) {
          runningStatus = status;
        }
      }
      
      const effectiveStatus = isRunningStatus ? runningStatus : status;
      
      if (effectiveStatus === 0xFF) {
        // Meta event
        const metaType = data[currentOffset++];
        const lengthResult = readVariableLength(data, currentOffset);
        const length = lengthResult.value;
        currentOffset += lengthResult.bytesRead;
        
        if (metaType === 0x51 && length === 3) {
          // Tempo change
          const microsPerBeat = 
            (data[currentOffset] << 16) |
            (data[currentOffset + 1] << 8) |
            data[currentOffset + 2];
          if (microsPerBeat > 0) {
            globalTempo = Math.round(60000000 / microsPerBeat);
          }
        }
        
        currentOffset += length;
      } else if (effectiveStatus === 0xF0 || effectiveStatus === 0xF7) {
        // SysEx event - skip
        const lengthResult = readVariableLength(data, currentOffset);
        currentOffset += lengthResult.bytesRead + lengthResult.value;
      } else if (effectiveStatus >= 0x80 && effectiveStatus < 0xF0) {
        // MIDI channel event
        const channel = effectiveStatus & 0x0F;
        const messageType = effectiveStatus & 0xF0;
        
        if (messageType === 0x80) {
          // Note Off
          const note = data[currentOffset++];
          const velocity = data[currentOffset++];
          events.push({
            type: 'noteOff',
            tick: absoluteTick,
            note,
            velocity,
            channel
          });
        } else if (messageType === 0x90) {
          // Note On
          const note = data[currentOffset++];
          const velocity = data[currentOffset++];
          if (velocity > 0) {
            events.push({
              type: 'noteOn',
              tick: absoluteTick,
              note,
              velocity,
              channel
            });
          } else {
            // Velocity 0 = Note Off
            events.push({
              type: 'noteOff',
              tick: absoluteTick,
              note,
              velocity: 0,
              channel
            });
          }
        } else if (messageType === 0xA0) {
          // Aftertouch - skip 2 bytes
          currentOffset += 2;
        } else if (messageType === 0xB0) {
          // Control Change - skip 2 bytes
          currentOffset += 2;
        } else if (messageType === 0xC0) {
          // Program Change - skip 1 byte
          currentOffset++;
        } else if (messageType === 0xD0) {
          // Channel Pressure - skip 1 byte
          currentOffset++;
        } else if (messageType === 0xE0) {
          // Pitch Bend - skip 2 bytes
          currentOffset += 2;
        }
      }
    }
    
    tracks.push(events);
    currentOffset = trackEnd;
  }
  
  return {
    format,
    ticksPerQuarterNote,
    tempo: globalTempo,
    tracks
  };
}

/**
 * Convert MIDI notes to SAM song template notes
 */
function midiToSongTemplate(midiData, options) {
  const { ticksPerQuarterNote, tempo, tracks } = midiData;
  const effectiveTempo = options.tempo || tempo;
  const msPerTick = (60000 / effectiveTempo) / ticksPerQuarterNote;
  
  // Collect all note events
  const allNotes = [];
  
  // Build a map of note-off times
  const noteOffMap = new Map();
  
  tracks.forEach((track, trackIndex) => {
    track.forEach(event => {
      if (event.type === 'noteOn') {
        const key = `${event.channel}-${event.note}`;
        const existing = noteOffMap.get(key);
        if (existing) {
          // We already have a pending note on, emit it first
          allNotes.push({
            pitch: existing.note,
            velocity: existing.velocity,
            durationMs: (event.tick - existing.tick) * msPerTick,
            startTick: existing.tick,
            track: trackIndex
          });
        }
        noteOffMap.set(key, event);
      } else if (event.type === 'noteOff') {
        const key = `${event.channel}-${event.note}`;
        const existing = noteOffMap.get(key);
        if (existing) {
          allNotes.push({
            pitch: existing.note,
            velocity: existing.velocity,
            durationMs: (event.tick - existing.tick) * msPerTick,
            startTick: existing.tick,
            track: trackIndex
          });
          noteOffMap.delete(key);
        }
      }
    });
  });
  
  // Sort by start time
  allNotes.sort((a, b) => a.startTick - b.startTick);
  
  // Remove very short notes (likely artifacts)
  const filteredNotes = allNotes.filter(n => n.durationMs >= 50);
  
  // Calculate pitch range if not specified
  let minMidiPitch = options.minPitch;
  let maxMidiPitch = options.maxPitch;
  
  if (minMidiPitch === null || maxMidiPitch === null) {
    const pitches = filteredNotes.map(n => n.pitch);
    if (pitches.length > 0) {
      minMidiPitch = minMidiPitch ?? Math.min(...pitches);
      maxMidiPitch = maxMidiPitch ?? Math.max(...pitches);
    } else {
      minMidiPitch = 48;
      maxMidiPitch = 72;
    }
  }
  
  // Convert notes to SAM template format
  const songLines = [];
  
  filteredNotes.forEach((note, index) => {
    // Map MIDI pitch to SAM pitch (inverted: higher MIDI = lower SAM)
    const pitchRange = maxMidiPitch - minMidiPitch;
    const normalizedPitch = pitchRange > 0 
      ? (note.pitch - minMidiPitch) / pitchRange 
      : 0.5;
    
    // Map to SAM pitch (32-96, inverted)
    const samPitch = Math.round(SAM_MAX_PITCH - normalizedPitch * (SAM_MAX_PITCH - SAM_MIN_PITCH));
    const clampedPitch = Math.max(SAM_MIN_PITCH, Math.min(SAM_MAX_PITCH, samPitch));
    
    // Determine phoneme based on note duration
    const duration = note.durationMs;
    let phoneme;
    
    if (options.syllableMode) {
      // Use simple syllable patterns
      phoneme = SYLLABLE_PATTERNS[index % SYLLABLE_PATTERNS.length];
    } else {
      // Use sustained patterns based on duration
      if (duration < 200) {
        phoneme = SUSTAIN_PATTERNS.short[index % SUSTAIN_PATTERNS.short.length];
      } else if (duration < 500) {
        phoneme = SUSTAIN_PATTERNS.medium[index % SUSTAIN_PATTERNS.medium.length];
      } else if (duration < 1000) {
        phoneme = SUSTAIN_PATTERNS.long[index % SUSTAIN_PATTERNS.long.length];
      } else {
        phoneme = SUSTAIN_PATTERNS.verylong[index % SUSTAIN_PATTERNS.verylong.length];
      }
    }
    
    // Use fixed speed (default 50 for singing mode)
    songLines.push({
      text: phoneme,
      speed: options.speed,
      pitch: clampedPitch
    });
  });
  
  return {
    metadata: {
      source: 'midi',
      tempo: effectiveTempo,
      originalTempo: tempo,
      pitchRange: [minMidiPitch, maxMidiPitch],
      noteCount: filteredNotes.length,
      samPitchRange: [SAM_MIN_PITCH, SAM_MAX_PITCH],
      sustain: options.sustain
    },
    notes: songLines
  };
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();
  
  if (!args.midiFile) {
    console.error(`${RED}✗ Error:${RESET} No MIDI file specified`);
    console.error(`Usage: node midi_to_song.js [options] <midi_file>`);
    console.error(`Run with --help for more information`);
    process.exit(1);
  }
  
  // Check if file exists
  if (!existsSync(args.midiFile)) {
    console.error(`${RED}✗ Error:${RESET} File not found: ${args.midiFile}`);
    process.exit(1);
  }
  
  try {
    // Read MIDI file
    if (args.verbose) {
      console.log(`${CYAN}▸ Reading MIDI file:${RESET} ${args.midiFile}`);
    }
    
    const buffer = readFileSync(args.midiFile);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const midiData = parseMidi(arrayBuffer);
    
    if (args.verbose) {
      console.log(`${CYAN}▸ MIDI Info:${RESET}`);
      console.log(`  Format: ${midiData.format}`);
      console.log(`  Tracks: ${midiData.tracks.length}`);
      console.log(`  Ticks per QN: ${midiData.ticksPerQuarterNote}`);
      console.log(`  Tempo: ${midiData.tempo} BPM`);
    }
    
    // Convert to song template
    if (args.verbose) {
      console.log(`${CYAN}▸ Converting to SAM template...${RESET}`);
    }
    
    const template = midiToSongTemplate(midiData, {
      speed: args.speed,
      tempo: args.tempo,
      minPitch: args.minPitch,
      maxPitch: args.maxPitch,
      sustain: args.sustain,
      phonemeType: args.phonemeType,
      syllableMode: args.syllableMode
    });
    
    if (args.verbose) {
      console.log(`${GREEN}▸ Conversion complete!${RESET}`);
      console.log(`  Notes: ${template.metadata.noteCount}`);
      console.log(`  Pitch Range: MIDI ${template.metadata.pitchRange[0]}-${template.metadata.pitchRange[1]}`);
      console.log(`  SAM Pitch Range: ${template.metadata.samPitchRange[0]}-${template.metadata.samPitchRange[1]}`);
    }
    
    // Generate output
    const output = template.notes;
    
    if (args.dryRun) {
      console.log(`\n${YELLOW}▸ DRY RUN - Not writing file${RESET}`);
      console.log(`\n${CYAN}▸ Output (${output.length} lines):${RESET}`);
      output.slice(0, 20).forEach((line, i) => {
        console.log(`  ${i + 1}: pitch=${line.pitch} speed=${line.speed} "${line.text}"`);
      });
      if (output.length > 20) {
        console.log(`  ... and ${output.length - 20} more lines`);
      }
    } else {
      // Determine output file
      let outputFile = args.output;
      if (!outputFile) {
        const baseName = basename(args.midiFile, extname(args.midiFile));
        outputFile = join(__dirname, 'songs', `${baseName}.json`);
      }
      
      writeFileSync(outputFile, JSON.stringify(output, null, 2));
      console.log(`${GREEN}▸ Song template written to:${RESET} ${outputFile}`);
      console.log(`${CYAN}▸ ${output.length} lines generated${RESET}`);
    }
    
    // Show first few lines as preview
    if (args.verbose || !args.dryRun) {
      console.log(`\n${CYAN}▸ Preview (first 5 lines):${RESET}`);
      output.slice(0, 5).forEach((line, i) => {
        const previewText = line.text.length > 30 ? line.text.substring(0, 30) + '...' : line.text;
        console.log(`  ${i + 1}: {"text": "${previewText}", "speed": ${line.speed}, "pitch": ${line.pitch}}`);
      });
    }
    
  } catch (err) {
    console.error(`${RED}✗ Error:${RESET} ${err.message}`);
    if (args.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
