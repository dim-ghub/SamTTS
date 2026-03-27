# SamTTS

A JavaScript-based Text-to-Speech library using the SAM (Software Automatic Mouth) algorithm.

## Installation

```bash
npm install
```

## Usage

### Run the demo
```bash
./run.sh
```

### Basic API

```javascript
const sam = require('./index.js');

// Generate speech
const audioBuffer = sam.speak('Hello World!', {
  speed: 72,    // 0-255, default 72
  pitch: 64,    // 0-255, default 64
  mouth: 128,   // 0-255, default 128
  throat: 128    // 0-255, default 128
});
```

## MIDI to Song

Convert MIDI files to SAM TTS songs:

```bash
node midi_to_song.js <path_to_midi_file>
```

## License

MIT License - see LICENSE file