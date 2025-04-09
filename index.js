import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bodyParser from 'body-parser';
import bcrypt from 'bcrypt';
import RSS from 'rss'; // RSS 모듈 추가
import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import { promisify } from 'util';

// .env 파일의 환경 변수를 로드합니다.
dotenv.config();

const client = new textToSpeech.TextToSpeechClient({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }
});

console.log("Google Client Email:", process.env.GOOGLE_CLIENT_EMAIL);
console.log("Google Private Key:", process.env.GOOGLE_PRIVATE_KEY ? "Exists" : "Doesn't exist");

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

console.log(`API Key: ${process.env.OPENAI_API_KEY}`);


//=============================라이브환경용.
// Initialize the Express app
// const app = express();

// CORS 설정
// const corsOptions = {
//   origin: 'https://englisheasystudy.com',
//   optionsSuccessStatus: 200,
//   credentials: true
// };
// app.use(cors(corsOptions));

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));
// // 정적 파일 제공 경로 설정
// app.use(express.static('public'));

//=============================

// Initialize the Express app 로컬용.
const app = express();

// CORS 설정
const corsOptions = {
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500', 'https://englisheasystudy.com'], // 허용할 도메인 추가
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 정적 파일 제공 경로 설정
app.use(express.static('public'));

//========================================

// 환경 변수에서 MongoDB URI 읽기
const uri = process.env.MONGO_URI;

mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('MongoDB 연결 성공');
})
.catch((error) => {
  console.error('MongoDB 연결 실패:', error);
});


const guestbookEntrySchema = new mongoose.Schema({
  title: String,
  message: String,
  nickname: String,
  password: String,
  date: { type: Date, default: Date.now },
  views: { type: Number, default: 0 },
  isSecret: { type: Boolean, default: false }
}, { collection: 'guestbook' });

const GuestbookEntry = mongoose.model('GuestbookEntry', guestbookEntrySchema);


app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', './views');


// 루트 경로 엔드포인트 추가
app.get('/', (req, res) => {
  res.send('Welcome to the English With Easy Word Backend!');
});

// 헬스 체크 엔드포인트 추가
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// 2.English Study Route
app.post('/englishstudy', async (req, res) => {
  try {
    const userInput = req.body.inputWord;

    if (!userInput) {
      throw new Error('No input word provided');
    }
    
    console.log("Input word:", userInput);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `
            You are an English teacher living in korea. you must not forget you are speaking to young students. You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny." You must avoid answering sensitive issues such as violence and suicide for students. Instead, when users request clarification on the meaning of a word, you must provide 10 example sentences that use key phrases and idiomatic expressions, providing a series of sentences that follow a logical sequence, all must be centered around the theme of the user input word. Each example should be formatted to include a direct English translation followed by its Korean translation. all centered around the theme of the selected topic. The output must be in this format:
            Example:
            "I got up early at 6 a.m. to start preparing for the trip. (나는 여행 준비를 위해 오전 6시에 일찍 일어났다.)"
            "After breakfast, I got dressed and packed my suitcase. (아침을 먹은 후 옷을 입고 여행 가방을 쌌다.)"
            "I got a taxi to the airport to avoid traffic. (교통 체증을 피하기 위해 공항으로 가는 택시를 탔다.)"
            "Once at the airport, I got my boarding pass from the self-check-in kiosk. (공항에 도착하자마자 셀프 체크인 키오스크에서 탑승권을 받았다.)"
            "I got through security quickly because of my priority pass. (우선 탑승 패스 덕분에 보안을 빠르게 통과했다.)"
            "Before boarding, I got a cup of coffee to stay awake. (탑승 전에 잠을 깨기 위해 커피 한 잔을 샀다.)"
            "On the flight, I got a comfortable seat by the window. (비행기에서는 창가에 편안한 자리를 얻었다.)"
            "After landing, I got my luggage from the baggage carousel. (착륙 후 수하물 컨베이어 벨트에서 내 짐을 찾았다.)"
            "I got directions to the hotel from the airport information desk. (공항 안내 데스크에서 호텔까지 가는 길을 물어보았다.)"
            "Once I reached the hotel, I got my room key and settled in for a restful night. (호텔에 도착하자마자 방 열쇠를 받고 편안한 밤을 보냈다.)"
        `
        },
        {
          role: 'user',
          content: userInput
        }
      ],
      model: 'gpt-3.5-turbo',
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Generated text:", responseContent);
    res.json({ assistant: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// New Business Advisor role
app.post('/business-advice', async (req, res) => {
  try {
    // Extract the question from the request body
    const question = req.body.questionInput;

    // Verify that the question exists
    if (!question) {
      return res.status(400).json({ advice: 'Please provide a valid question.' });
    }

    console.log("Question input:", question);  // 디버깅을 위해 추가

    // Call the OpenAI API to get advice
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in korea.You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny. You also must not encourage people to do illegal or unethical things such as violence, suicide. you must avoid sensitive issues. Other than that, You must provide answers to the questions that students ask. You must answer in english. you must not forget you are speaking to young students.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    // Extract the first response content
    const responseContent = completion.data.choices[0].message.content;
    console.log("Sending Business Advice response:", responseContent);

    // Send back the advice as JSON
    res.json({ advice: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


// English Chat Route
app.post('/english-chat', async (req, res) => {
  try {
    // Extract user input from the request body
    const userInput = req.body.inputMessage;

    if (!userInput) {
      throw new Error('No input message provided');
    }

    console.log("Input message:", userInput);  // 디버깅을 위해 추가

    // Call the OpenAI API to generate a response
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in Korea. You must avoid responding to inquiries that contain inappropriate words for students. You must help user to improve english skills.'
        },
        {
          role: 'user',
          content: userInput
        }
      ],
    });

    // Extract the response content
    const responseContent = completion.choices[0].message.content;
    console.log("Sending English Chat response:", responseContent);

    // Send back the response as JSON
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error);

    // 보다 상세한 오류 메시지 출력
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      res.status(500).send(`Error processing your request: ${error.message}`);
    }
  }
});


// New Speaking Practice Route
app.post('/speaking-practice', async (req, res) => {
  try {
    const spokenText = req.body.spokenText;

    if (!spokenText) {
      throw new Error('No spoken text provided');
    }

    console.log("Spoken text:", spokenText);  // Debugging

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in Korea. Avoid inappropriate, sexual, or offensive language. Provide conversational responses and ask follow-up questions.'
        },
        {
          role: 'user',
          content: spokenText
        }
      ],
    });

    const responseContent = completion.data.choices[0].message.content;
    console.log("Sending Speaking Practice response:", responseContent);
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// New Speaking Practice Route2
app.post('/speaking-practice2', async (req, res) => {
  try {
    const spokenText = req.body.spokenText;

    if (!spokenText) {
      throw new Error('No spoken text provided');
    }

    console.log("Spoken text:", spokenText);  // Debugging

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher living in Korea. Avoid inappropriate, sexual, or offensive language. Provide conversational responses and ask follow-up questions.'
        },
        {
          role: 'user',
          content: spokenText
        }
      ],
    });

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Speaking Practice response:", responseContent);
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error.message, error.stack);
    res.status(500).json({ message: `Error processing your request: ${error.message}` });
  }
});


const words = [
  'accept', 'achieve', 'add', 'admire', 'admit', 'advise', 'afford', 'agree', 'alert', 'allow',
  'amuse', 'analyse', 'announce', 'annoy', 'answer', 'apologize', 'appear', 'applaud', 'appreciate', 'approve',
  'argue', 'arrange', 'arrest', 'arrive', 'ask', 'assist', 'assure', 'attach', 'attack', 'attempt',
  'attend', 'attract', 'avoid', 'back', 'bake', 'balance', 'ban', 'bang', 'base', 'bat',
  'bathe', 'battle', 'be', 'beam', 'bear', 'beat', 'become', 'beg', 'begin', 'behave',
  'believe', 'belong', 'bend', 'bet', 'bind', 'bite', 'bleach', 'bless', 'blind', 'blink',
  'blot', 'blow', 'boast', 'boil', 'bolt', 'bomb', 'book', 'bore', 'borrow', 'bounce',
  'bow', 'box', 'brake', 'branch', 'breathe', 'breed', 'bring', 'broadcast', 'brush', 'bubble',
  'build', 'bump', 'burn', 'burst', 'bury', 'buy', 'calculate', 'call', 'camp', 'care',
  'carry', 'carve', 'cause', 'challenge', 'change', 'charge', 'chase', 'cheat', 'check', 'cheer',
  'chew', 'choke', 'choose', 'chop', 'claim', 'clap', 'clean', 'clear', 'clip', 'close',
  'coach', 'coil', 'collect', 'colour', 'comb', 'come', 'command', 'communicate', 'compare', 'compete',
  'complain', 'complete', 'concentrate', 'concern', 'confess', 'confuse', 'connect', 'consider', 'consist', 'contain',
  'continue', 'copy', 'correct', 'cough', 'count', 'cover', 'crack', 'crash', 'crawl', 'cross',
  'crush', 'cry', 'cure', 'curl', 'curve', 'cut', 'cycle', 'dam', 'damage', 'dance',
  'dare', 'deal', 'decay', 'deceive', 'decide', 'decorate', 'delay', 'delight', 'deliver', 'depend',
  'describe', 'desert', 'deserve', 'destroy', 'detect', 'develop', 'disagree', 'disappear', 'disapprove', 'disarm',
  'discover', 'dislike', 'divide', 'double', 'doubt', 'drag', 'drain', 'dream', 'dress', 'drip',
  'drop', 'drown', 'drum', 'dry', 'dust', 'earn', 'educate', 'embarrass', 'employ', 'empty',
  'encourage', 'end', 'enjoy', 'enter', 'entertain', 'escape', 'examine', 'excite', 'excuse', 'exercise',
  'exist', 'expand', 'expect', 'explain', 'explode', 'extend', 'face', 'fade', 'fail', 'fancy',
  'fasten', 'fax', 'fear', 'fence', 'fetch', 'fight', 'file', 'fill', 'film', 'find',
  'fire', 'fit', 'fix', 'flap', 'flash', 'float', 'flood', 'flow', 'flower', 'fold',
  'follow', 'fool', 'force', 'form', 'found', 'frame', 'freeze', 'frighten', 'fry', 'gather',
  'gaze', 'gel', 'get', 'give', 'glow', 'glue', 'grab', 'grate', 'grease', 'greet',
  'grin', 'grip', 'groan', 'guarantee', 'guard', 'guess', 'guide', 'hammer', 'hand', 'handle',
  'hang', 'happen', 'harass', 'harm', 'hate', 'haunt', 'heal', 'heap', 'hear', 'heat',
  'help', 'hook', 'hop', 'hope', 'hover', 'hug', 'hum', 'hunt', 'hurry', 'hurt',
  'identify', 'ignore', 'imagine', 'impress', 'improve', 'include', 'increase', 'influence', 'inform', 'inject',
  'injure', 'instruct', 'intend', 'interest', 'interfere', 'interrupt', 'introduce', 'invent', 'invite', 'involve',
  'iron', 'irritate', 'jail', 'jam', 'jog', 'join', 'joke', 'judge', 'juggle', 'jump',
  'kick', 'kill', 'kiss', 'kneel', 'knit', 'knock', 'knot', 'know', 'label', 'land',
  'last', 'laugh', 'launch', 'learn', 'level', 'license', 'lick', 'lie', 'lift', 'light',
  'like', 'list', 'listen', 'live', 'load', 'lock', 'long', 'look', 'lose', 'love',
  'maintain', 'make', 'manage', 'march', 'mark', 'marry', 'match', 'mate', 'matter', 'measure',
  'meddle', 'melt', 'memorize', 'mend', 'mess up', 'milk', 'mine', 'miss', 'mix', 'moan',
  'moor', 'mourn', 'move', 'mow', 'muddle', 'mug', 'multiply', 'murder', 'nail', 'name',
  'need', 'nest', 'nod', 'note', 'notice', 'number', 'obey', 'object', 'observe', 'obtain',
  'occur', 'offend', 'offer', 'open', 'operate', 'order', 'overflow', 'owe', 'own', 'pack',
  'paddle', 'paint', 'park', 'part', 'pass', 'paste', 'pat', 'pause', 'pay', 'peck',
  'pedal', 'peel', 'peep', 'perform', 'permit', 'phone', 'pick', 'pinch', 'pine', 'place',
  'plan', 'plant', 'play', 'please', 'plug', 'point', 'poke', 'polish', 'pop', 'possess',
  'post', 'pour', 'practice', 'pray', 'preach', 'precede', 'prefer', 'prepare', 'present', 'preserve',
  'press', 'pretend', 'prevent', 'prick', 'print', 'produce', 'program', 'promise', 'protect', 'provide',
  'pull', 'pump', 'punch', 'puncture', 'punish', 'push', 'question', 'queue', 'race', 'radiate',
  'rain', 'raise', 'reach', 'realize', 'receive', 'recognize', 'record', 'reduce', 'reflect', 'refuse',
  'regret', 'reign', 'reject', 'rejoice', 'relax', 'release', 'rely', 'remain', 'remember', 'remind',
  'remove', 'repair', 'repeat', 'replace', 'reply', 'report', 'reproduce', 'request', 'rescue', 'retire',
  'return', 'rhyme', 'ride', 'ring', 'rinse', 'risk', 'rob', 'rock', 'roll', 'rot',
  'rub', 'ruin', 'rule', 'run', 'rush', 'sack', 'sail', 'satisfy', 'save', 'saw',
  'say', 'scare', 'scatter', 'scream', 'screw', 'scribble', 'scrub', 'seal', 'search', 'see',
  'sell', 'send', 'sense', 'separate', 'serve', 'set', 'settle', 'sew', 'shade', 'shake',
  'shape', 'share', 'shave', 'shelter', 'shine', 'shiver', 'shock', 'shop', 'shrug', 'sigh',
  'sign', 'signal', 'sin', 'sip', 'sit', 'ski', 'skip', 'slap', 'sleep', 'slice',
  'slide', 'slip', 'slow', 'smash', 'smell', 'smile', 'smoke', 'snatch', 'sneeze', 'sniff',
  'snore', 'snow', 'soak', 'soothe', 'sound', 'sow', 'spark', 'sparkle', 'speak', 'spell',
  'spend', 'spill', 'spoil', 'spot', 'spray', 'sprout', 'squash', 'squeak', 'squeal', 'squeeze',
  'stain', 'stamp', 'stand', 'stare', 'start', 'stay', 'steer', 'step', 'stir', 'stitch',
  'stop', 'store', 'strap', 'strengthen', 'stretch', 'strip', 'stroke', 'stuff', 'subtract', 'succeed',
  'suck', 'suffer', 'suggest', 'suit', 'supply', 'support', 'suppose', 'surprise', 'surround', 'suspect',
  'suspend', 'switch', 'talk', 'tame', 'tap', 'taste', 'teach', 'tear', 'tease', 'telephone',
  'tell', 'tempt', 'terrify', 'thank', 'thaw', 'tick', 'tickle', 'tie', 'time', 'tip',
  'tire', 'touch', 'tour', 'tow', 'trace', 'trade', 'train', 'transport', 'trap', 'travel',
  'treat', 'tremble', 'trick', 'trip', 'trot', 'trouble', 'trust', 'try', 'turn', 'twist',
  'type', 'undress', 'unfasten', 'unite', 'unlock', 'unpack', 'untidy', 'use', 'vanish', 'visit',
  'wail', 'wait', 'wake', 'walk', 'wander', 'want', 'warm', 'warn', 'wash', 'waste',
  'watch', 'water', 'wave', 'wear', 'weigh', 'welcome', 'whine', 'whip', 'whirl', 'whisper',
  'whistle', 'wink', 'wipe', 'wish', 'wobble', 'wonder', 'work', 'worry', 'wrap', 'wreck',
  'wrestle', 'wriggle', 'write', 'yawn', 'yell', 'zip', 'zoom'
];


function getRandomWord() {
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex];
}

app.get('/', (req, res) => {
  res.send('Welcome to the English With Easy Word Backend!');
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

//=================page16html
// Function to get a random word (renamed to getRandomWord2)
function getRandomWord2() {
  const words = [
    'be', 'have', 'do', 'say', 'make', 'go', 'take', 'come', 'see', 'know',
    'get', 'give', 'think', 'tell', 'work', 'call', 'try', 'ask', 'need', 'feel',
    'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem', 'help', 'talk',
    'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'like', 'live', 'believe',
    'hold', 'bring', 'happen', 'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet',
    'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop',
    'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win',
    'offer', 'remember', 'love', 'consider', 'buy', 'wait', 'serve', 'die', 'send', 'expect',
    'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise', 'pass',
    'sell', 'require', 'report', 'decide', 'pull', 'return', 'explain', 'hope', 'develop', 'carry',
    'break', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'cover', 'catch', 'draw',
    'choose', 'refer', 'appear', 'open', 'close', 'push', 'save', 'thank', 'try', 'use',
    'want', 'work', 'find', 'give', 'show', 'tell', 'call', 'ask', 'need', 'feel',
    'help', 'like', 'live', 'play', 'run', 'move', 'believe', 'bring', 'happen', 'write',
    'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'set', 'learn', 'change', 'watch',
    'follow', 'stop', 'create', 'speak', 'read', 'allow', 'spend', 'grow', 'offer', 'remember',
    'love', 'consider', 'buy', 'wait', 'die', 'send', 'expect', 'build', 'stay', 'fall',
    'cut', 'reach', 'kill', 'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report',
    'decide', 'pull', 'return', 'hope', 'develop', 'carry', 'break', 'receive', 'agree', 'support',
    'hit', 'produce', 'eat', 'cover', 'catch', 'draw', 'choose', 'refer', 'appear', 'open',
    'close', 'push', 'thank', 'use', 'want', 'work', 'find', 'give', 'show', 'tell',
    'call', 'ask', 'need', 'feel', 'help', 'like', 'live', 'play', 'run', 'move',
    'believe', 'bring', 'happen', 'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include',
    'set', 'learn', 'change', 'watch', 'follow', 'stop', 'create', 'speak', 'read', 'allow',
    'spend', 'grow', 'offer', 'remember', 'love', 'consider', 'buy', 'wait', 'die', 'send',
    'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'suggest', 'raise',
    'pass', 'sell', 'require', 'report', 'decide', 'pull', 'return', 'hope', 'develop', 'carry',
    'break', 'receive', 'agree', 'support', 'hit', 'produce', 'eat', 'cover', 'catch', 'draw',
    'choose', 'refer', 'appear'
];
  return words[Math.floor(Math.random() * words.length)];
}

// Quiz Route
// Quiz Route=======================================================================================
app.post('/quiz', async (req, res) => {
  try {
    const word = getRandomWord2();

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. Create a vocabulary quiz for beginner to early middle school students. The sentence should be very short and simple, with a blank (____) where a word is missing. After the sentence, provide 4 multiple-choice options in this exact format:\n\n1. word\n2. word\n3. word\n4. word\n\nDo not include any hints or Korean translations.'
        },
        {
          role: 'user',
          content: `Create a quiz using the word "${word}". Write a simple sentence with a blank (____), then give 4 answer options numbered 1 to 4.`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Quiz response:", responseContent);
    res.json({ quiz: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// Check Answer Route
app.post('/quiz/check', async (req, res) => {
  try {
    const { question, answer } = req.body;

    if (!question || !answer) {
      throw new Error('Question or answer not provided');
    }

    console.log("Question:", question);
    console.log("Answer:", answer);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. A student answered a vocabulary quiz. Based on the sentence and selected answer, return the result using the following exact format :\n\nAnswer : <correct word>\nSentence : <the complete sentence with the correct word filled in>\nTranslation : <polite Korean translation of the sentence>\nExplanation : <brief explanation in English of why the word is correct>'
        },
        {
          role: 'user',
          content: `Sentence : ${question}\nSelected answer : ${answer}\n\nPlease respond exactly in this format :\nAnswer : word\nSentence : full sentence\nTranslation : polite Korean\nExplanation : short reason why the word is correct`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Check response:", responseContent);
    res.json({ result: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

// Show Answer Route
app.post('/quiz/show', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      throw new Error('Question not provided');
    }

    console.log("Received question:", question);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. You must provide all the possible similar words close to the answer that the user entered in the blank and provide explanations why the expression is correct or incorrect.'
        },
        {
          role: 'user',
          content: `What is the correct answer for the following quiz question?\n${question}`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log("Sending Show Answer response:", responseContent);
    res.json({ answer: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});




//page================ Get Hint Route
app.post('/get-hint', async (req, res) => {
  try {
    const { item, hintIndex } = req.body;

    if (!item || hintIndex === undefined) {
      throw new Error('Item or hintIndex not provided');
    }

    console.log(`Item: ${item}, HintIndex: ${hintIndex}`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant providing hints for a 20 Questions game. You must not provide the same hints twice. You must consider students are middle or high school students, so the level should be appropriate for students.'
        },
        {
          role: 'user',
          content: `Provide a hint for the word "${item}" suitable for hint number ${hintIndex + 1}.`
        }
      ],
    });

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content.trim();
    console.log("Sending Hint response:", responseContent);
    res.json({ hint: responseContent });
  } catch (error) {
    console.error('Error:', error);
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      res.status(500).send(`Error processing your request: ${error.message}`);
    }
  }
});

// Get Random Item Route
app.get('/get-random-item', (req, res) => {
  try {
    const randomItem = getRandomWord();
    console.log(`Random item selected: ${randomItem}`);
    res.json({ item: randomItem });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


// New Route to generate short text   page21=================================
app.post('/generate-short-text', async (req, res) => {
  try {
    const topic = req.body.topic;

    if (!topic) {
      throw new Error('No topic provided');
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `
            You are an English teacher living in Korea. You must not forget you are speaking to young students. Avoid responding to inquiries that contain inappropriate, sexual, or offensive language. Provide a long academic text (about 1000 characters) related to the selected topic. The text should be simple, easy to understand, and suitable for young students.
          `
        },
        {
          role: 'user',
          content: `Generate a long text for the topic "${topic}". The text should be about 1000 characters long.`
        }
      ],
      max_tokens: 512
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    let responseContent = completion.choices[0].message.content;
    console.log("Generated short text:", responseContent);

    // Ensure text is close to 1000 characters
    while (responseContent.length < 900) { // Set a lower threshold for minimum length
      const additionalCompletion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `
              You are an English teacher living in Korea. You must not forget you are speaking to young students. Avoid responding to inquiries that contain inappropriate, sexual, or offensive language. Provide a long academic text (about 1000 characters) related to the selected topic. The text should be simple, easy to understand, and suitable for young students.
            `
          },
          {
            role: 'user',
            content: `Continue the text for the topic "${topic}". Ensure the total length is about 1000 characters.`
          }
        ],
        max_tokens: 512
      });

      console.log("Additional completion response:", JSON.stringify(additionalCompletion, null, 2));

      if (!additionalCompletion.choices || additionalCompletion.choices.length === 0) {
        throw new Error('No choices in the additional completion response');
      }

      const additionalContent = additionalCompletion.choices[0].message.content;
      responseContent += " " + additionalContent;
      console.log("Extended short text:", additionalContent);
    }

    res.json({ shortText: responseContent });
  } catch (error) {
    console.error('Error generating short text:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


app.post('/get-translation-explanation', async (req, res) => {
  try {
    const shortText = req.body.shortText;

    if (!shortText) {
      throw new Error('No short text provided');
    }

    console.log("Short text:", shortText);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `
            You are an English teacher living in Korea. Provide the Korean translation for the following text.
          `
        },
        {
          role: 'user',
          content: `Provide a translation for the following text: "${shortText}". The translation must be in Korean.`
        }
      ],
      max_tokens: 3000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;
    console.log("Translation and explanation:", responseContent);

    res.json({ translationExplanation: responseContent });
  } catch (error) {
    console.error('Error getting translation and explanation:', error.message);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//generated sentences=======================================
app.post('/generate-sentences', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for tourists. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for tourists related to the "${topic}".` }
      ],
      max_tokens: 512
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//===============================================================================
app.post('/get-synonyms', async (req, res) => {
  try {
    const { word } = req.body;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Provide synonyms and related example sentences followed by the Korean translation in parentheses. the format must be "Apart - We sat apart from each other during the meeting. (우리는 회의 중에 서로 떨어져 앉았다.)".'
        },
        {
          role: 'user',
          content: `Give me synonyms and related simple and useful expressions as much as you can, followed by the Korean translation in parentheses for the word "${word}".`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});

//================================================================================page22.html
app.post('/ask-question', async (req, res) => {
  try {
    const { question } = req.body;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer the user\'s question based on the provided synonyms and example sentences. You must use the same language that users enter. korean to korean, english to english.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});


//================================================이 코드 보류page23
app.post('/get-synonyms-korean', async (req, res) => {
  try {
    const { word } = req.body;
    console.log(`Received word: ${word}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Provide synonyms and related example sentences followed by the Korean translation in parentheses. The format must be "Apart - We sat apart from each other during the meeting. (우리는 회의 중에 서로 떨어져 앉았다.)".'
        },
        {
          role: 'user',
          content: `Give me synonyms and related simple and useful expressions as much as you can, followed by the Korean translation in parentheses for the word "${word}".`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});

app.post('/ask-question-korean', async (req, res) => {
  try {
    const { question } = req.body;
    console.log(`Received question: ${question}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant. Answer the user\'s question based on the provided synonyms and example sentences. You must use the same language that users enter. Korean to Korean, English to English.'
        },
        {
          role: 'user',
          content: question
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    res.json({ synonyms: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});

//==========================================================
app.post('/get-fortune', async (req, res) => {
  try {
    const { word } = req.body;
    console.log(`Received word: ${word}`); // 요청 확인을 위한 로그

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content:`
            You are a friendly and encouraging fortune teller who gives simple and positive predictions for young students.
            Your answers must be in simple English followed by Korean translations.
            Whenever a user provides a date, time, and place, you weave these elements into your fortune-telling, 
            offering clear and supportive predictions. Each response must be crafted with care to evoke a sense of positivity and motivation.
            Ensure that each prediction includes specific details such as:
            - Positive events that may happen.
            - Encouraging emotional states or changes the person might experience.
            - Natural phenomena (like weather, blooming flowers, etc.) related to the place and time provided.
            - Simple symbolic references that can be easily understood.
            - How these details connect to the person's past, present, or future in a positive way.
          ` },
        {
          role: 'user',
          content: `Please provide a fortune: ${word}`
        }
      ],
    });

    const responseContent = completion.choices[0].message.content;
    console.log(`Response from OpenAI: ${responseContent}`); // 응답 확인을 위한 로그
    res.json({ fortune: responseContent });
  } catch (error) {
    console.error('Error fetching synonyms:', error);
    res.status(500).send('Error fetching synonyms.');
  }
});


//generated sentences=======================================page25
app.post('/generate-sentences2', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for students. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for students related to the "${topic}".` }
      ],
      max_tokens: 1000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

//===============================================================================

//generated sentences=======================================page25
app.post('/generate-sentences-routines', async (req, res) => {
  try {
    const { topic } = req.body;

    if (!topic) {
      return res.status(400).json({ advice: 'Please provide a valid topic.' });
    }

    console.log("Selected topic:", topic);

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for students. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for students related to the "${topic}".` }
      ],
      max_tokens: 1000
    });

    console.log("Completion response:", JSON.stringify(completion, null, 2));

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No choices in the completion response');
    }

    const responseContent = completion.choices[0].message.content;

    res.json({ sentences: responseContent });
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error details:', error.response ? error.response.data : 'No additional error details');
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


//==================================guestbook.


// New entry 생성 시 비밀번호 해시 처리
app.get('/guestbook', async (req, res) => {
  try {
    const entries = await GuestbookEntry.find();
    res.status(200).json({ entries });
  } catch (error) {
    res.status(500).json({ error: 'Error retrieving guestbook entries' });
  }
});

app.post('/guestbook', async (req, res) => {
  const { title, message, nickname, password } = req.body;

  if (!title || !message || !nickname || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newEntry = new GuestbookEntry({ title, message, nickname, password: hashedPassword });

  try {
    await newEntry.save();
    res.status(201).json({ entry: newEntry });
  } catch (error) {
    res.status(500).json({ error: 'Error saving guestbook entry' });
  }
});

app.post('/viewpost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await GuestbookEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await bcrypt.compare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  entry.views += 1;
  await entry.save();
  res.json({ entry });
});

app.post('/deletepost', async (req, res) => {
  const { id, password } = req.body;
  const entry = await GuestbookEntry.findById(id);

  if (!entry) {
    return res.status(404).json({ error: 'Post not found' });
  }

  const isMatch = await bcrypt.compare(password, entry.password);
  if (!isMatch) {
    return res.status(403).json({ error: 'Invalid password' });
  }

  try {
    await GuestbookEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting guestbook entry' });
  }
});
///=============
const adminPassword = process.env.ADMIN_PASSWORD;

app.post('/admin/deletepost', async (req, res) => {
  const { id, adminPasswordInput } = req.body;

  if (adminPasswordInput !== adminPassword) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  try {
    const entry = await GuestbookEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await GuestbookEntry.findByIdAndDelete(id);
    res.json({ message: 'Post deleted by admin' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting post' });
  }
});

app.post('/updatepost', async (req, res) => {
  try {
    const { id, password, title, message, nickname, isSecret } = req.body;
    const entry = await GuestbookEntry.findById(id);
    if (!entry) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const isMatch = await bcrypt.compare(password, entry.password);
    if (!isMatch) {
      return res.status(403).json({ error: 'Invalid password' });
    }
    entry.title = title;
    entry.message = message;
    entry.nickname = nickname;
    entry.isSecret = isSecret;
    await entry.save();
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: 'Error updating post' });
  }
});
//==============================================================================
// RSS 피드 엔드포인트 추가
app.get('/rss', async (req, res) => {
  try {
    // 데이터베이스에서 최신 포스트를 가져옵니다.
    const entries = await GuestbookEntry.find().sort({ date: -1 }).limit(20);

    // RSS 피드 생성
    const feed = new RSS({
      title: 'free english study',
      description: 'English Happy Learning',
      feed_url: 'https://englisheasystudy.com/rss',
      site_url: 'https://englisheasystudy.com/',
      language: 'en'
    });

    // 포스트 데이터를 RSS 피드에 추가
    entries.forEach(entry => {
      feed.item({
        title: entry.title,
        description: entry.message,
        url: `https://englisheasystudy.com/${entry.url}`,
        date: entry.date
      });
    });

    // RSS 피드를 XML 형식으로 응답
    res.type('application/rss+xml');
    res.send(feed.xml());
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    res.status(500).send('Error generating RSS feed.');
  }
});

// 1음성 생성 엔드포인트 추가////////////////

app.get('/generate-audio', async (req, res) => {
  const { text, language, voice } = req.query;
  const languageCode = language || 'en-US'; // 기본값을 미국 영어로 변경

  // 기본 음성 설정
  const defaultVoiceMap = {
    'en-AU': ['en-AU-Neural2-B', 'en-AU-Neural2-C'], // 호주 남성, 여성
    'en-IN': ['en-IN-Journey-D', 'en-IN-Wavenet-A'], // 인도 남성, 여성
    'en-GB': ['en-GB-News-I'], // 영국 영어 여성, 남성
    'en-US': ['en-US-News-N', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Neural2-J', 'en-US-Wavenet-D'], // 미국 영어 남성, 여성
    'ko-KR': ['ko-KR-Wavenet-C'] // 한국어 남성 음성
  };

  // 음성 선택 (voice가 없으면 기본 음성 사용)
  const voiceName = voice || defaultVoiceMap[language]?.[0] || 'en-US-News-N';

  console.log(`🟢 Requested Text: ${text}`);
  console.log(`🟢 Requested Language: ${language}`);
  console.log(`🟢 Requested Voice: ${voice}`);
  console.log(`🟢 Selected Voice: ${voiceName}`);

  // 올바른 음성 설정이 없으면 에러 반환
  if (!voiceName) {
    console.error('🔴 Invalid language or voice specified.');
    return res.status(400).json({ error: 'Invalid language or voice specified.' });
  }

  // 음성 생성 요청 설정
  const request = {
    input: { text },
    voice: {
      languageCode,
      name: voiceName
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 1.0,
      pitch: 0.0
    }
  };

  try {
    const [response] = await textToSpeechClient.synthesizeSpeech(request);

    // 오류 확인을 위해 로그 추가
    console.log('🟢 Audio response received successfully!');

    res.set('Content-Type', 'audio/mpeg');
    res.send(response.audioContent);
  } catch (error) {
    console.error('🔴 Error generating audio:', error.message);
    res.status(500).json({ error: `Error generating audio: ${error.message}` });
  }
});

//////////////////////////////////////////2222222222222222222 audio////////////////////////////////////////////
// app.get('/generate-audio', async (req, res) => {
//   const { text, language } = req.query;
//   const languageCode = language;
//   const voiceName = language === 'ko-KR' ? 'ko-KR-Wavenet-A' : 'en-GB-Wavenet-D';

//   const request = {
//     input: { text },
//     voice: {
//       languageCode,
//       name: voiceName,
//       ssmlGender: 'NEUTRAL'
//     },
//     audioConfig: {
//       audioEncoding: 'MP3',
//       speakingRate: 1.0,
//       pitch: 0.0
//     },
//   };

//   try {
//     const [response] = await client.synthesizeSpeech(request);
//     res.set('Content-Type', 'audio/mpeg');
//     res.send(response.audioContent);
//   } catch (error) {
//     console.error('Error generating audio:', error.message);
//     res.status(500).json({ error: 'Error generating audio' });
//   }
// });

//===============================================================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Endpoints:');
  console.log(`- English Study: http://localhost:${PORT}/englishstudy`);
  console.log(`- Business Advice: http://localhost:${PORT}/business-advice`);
  console.log(`- English Chat: http://localhost:${PORT}/english-chat`);
  console.log(`- Health Check: http://localhost:${PORT}/healthz`);
  console.log(`- Root: http://localhost:${PORT}/`);
  console.log(`- Speaking Practice: http://localhost:${PORT}/speaking-practice`);
  console.log(`- Speaking Practice2: http://localhost:${PORT}/speaking-practice2`);
  console.log(`- Quiz: http://localhost:${PORT}/quiz`);
  console.log(`- Quiz Check: http://localhost:${PORT}/quiz/check`);
  console.log(`- Show Answer: http://localhost:${PORT}/quiz/show`);
  console.log(`- Get Hint: http://localhost:${PORT}/get-hint`);
  console.log(`- Get Random Item: http://localhost:${PORT}/get-random-item`);
  console.log(`- Generate Sentences: http://localhost:${PORT}/generate-sentences`);
  console.log(`- Generate Short Text: http://localhost:${PORT}/generate-short-text`);
  console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-translation-explanation`);
  console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-synonyms`);
  console.log(`- Get Translation and Explanation: http://localhost:${PORT}/ask-question`);
  // console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-synonyms-korean`);
  // console.log(`- Get Translation and Explanation: http://localhost:${PORT}/ask-question-korean`);
  console.log(`- Get Translation and Explanation: http://localhost:${PORT}/get-fortune`);
  console.log(`- Generate Sentences: http://localhost:${PORT}/generate-sentences-routines`);
  console.log(`- Guestbook: http://localhost:${PORT}/guestbook`);
  console.log(`- Ads.txt: http://localhost:${PORT}/ads.txt`);
  console.log(`- Generate Audio: http://localhost:${PORT}/generate-audio`);
});
