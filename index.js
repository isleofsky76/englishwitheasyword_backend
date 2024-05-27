import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';


// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Set up the Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2.English Study Route
app.post('/englishstudy', async (req, res) => {
  try {
    const userInput = req.body.inputWord; 
    // Assigning the value of req.body.inputWord to the variable userInput

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `
            You are an English teacher living in korea. you must not forget you are speaking to young students. You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny." You must avoid answering sensitive issues such as violence and suicide for students. Instead, when users request clarification on the meaning of a word, you must provide 10 example sentences that use key phrases and idiomatic expressions, providing a series of sentences that follow a logical sequence, all centered around the theme of the user input word. Each example should be formatted to include a direct English translation followed by its Korean translation. The output must be in this format:
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
        
        {role: 'user', 
          content: userInput}
      ],

      model: 'gpt-3.5-turbo',
    });

    const responseContent = completion.choices[0].message['content'];
    console.log("Sending response:", responseContent);
    res.json({ assistant: responseContent });
  } catch (error) {
    console.error('Error:', error);
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
   // Call the OpenAI API to get advice
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are an English teacher living in korea.You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck," "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny. You also must not encourage people to do illegal or unethical things such as violence, suicide. you must avoid sensitive issues.  Other than that, You must provide answers to the questions that students ask. You must answer in english. you must not forget you are speaking to young students.' },
        { role: 'user', content: question }
      ],
      model: 'gpt-3.5-turbo',
    });

     // Extract the first response content
    const responseContent = completion.choices[0].message['content'];
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

    // Call the OpenAI API to generate a response
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are an English teacher living in korea.You must avoid responding to inquiries that contain inappropriate, sexual, or offensive language, including explicit terms such as "fuck,","porn", "sex," "cock," "pussy," "dick," "tits," "retard," "fag," "cunt," "asshole," "bitch," "whore," and "tranny. You also must not encourage people to do illegal or unethical things such as violence, suicide. you must avoid sensitive issues. Other than that, You must provide answers to the questions that students ask. You answer first in English and then in Korean. you must not forget you are speaking to young students.' },
        { role: 'user', content: userInput }
      ],
      model: 'gpt-3.5-turbo',
    });

    // Extract the response content
    const responseContent = completion.choices[0].message['content'];
    console.log("Sending English Chat response:", responseContent);

    // Send back the response as JSON
    res.json({ response: responseContent });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing your request: ${error.message}`);
  }
});



// Start the server
app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
  console.log('Endpoints:');
  console.log('- English Study: http://localhost:3000/englishstudy');
  console.log('- Business Advice: http://localhost:3000/business-advice');
  console.log('- English Chat: http://localhost:3000/english-chat');
});