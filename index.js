import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// .env 파일의 환경 변수를 로드합니다.
dotenv.config();

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

console.log(`API Key: ${process.env.OPENAI_API_KEY}`);

// Set up the Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
          content: 'You are an English teacher living in Korea. You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "porn," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny." You also must not encourage people to do illegal or unethical things such as violence, suicide. You must avoid sensitive issues. Other than that, you must provide answers to the questions that students ask. You answer only in English. You must lead the conversation by asking follow-up questions. You must not forget you are speaking to young students.'
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


app.post('/quiz', async (req, res) => {
  try {
    const word = getRandomWord();

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher. You must provide a quiz with 1 example sentence using a word in the (____), suitable for middle and high school students.'
        },
        {
          role: 'user',
          content: `Create an example sentence using a word "${word}". Ensure that a word is used in the blank indicated by (____). The sentence should be at a middle to high school level.`
        }
      ],
    });

    const responseContent = completion.data.choices[0].message.content;
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
          content: 'You are an English teacher. Check if the student\'s answer is correct for the sentence.'
        },
        {
          role: 'user',
          content: `Question: ${question}\nAnswer: ${answer}`
        }
      ],
    });

    const responseContent = completion.data.choices[0].message.content;
    console.log("Sending Check response:", responseContent);
    res.json({ result: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});

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
          content: 'You are an English teacher. You must provide all the possible similar words close to the answer that the user entered in the blank and provide explanations why the expression is correct or incorrect..'
        },
        {
          role: 'user',
          content: `What is the correct answer for the following quiz question?\n${question}`
        }
      ],
    });

    const responseContent = completion.data.choices[0].message.content;
    console.log("Sending Show Answer response:", responseContent);
    res.json({ answer: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});


// Get Hint Route
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
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for tourists. Each sentence must be in English followed by the Korean translation in parentheses. The format should be: "Please keep your belongings close to you at all times. (소지품을 항상 가까이에 보관해주세요.)"'},
        { role: 'user', content: `Generate useful expressions in english and korean for tourists related to the "${topic}".` }
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
        { role: 'system', content: 'You are an English teacher. Provide 10 useful sentences for tourists. You must write english and korean translation together' },
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


//================================================================================
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
});

