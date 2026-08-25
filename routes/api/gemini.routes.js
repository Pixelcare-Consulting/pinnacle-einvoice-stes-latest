const express = require('express');
const router = express.Router();
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Use environment variables for API keys in production
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDsPA4DKpJ5a_tdVQxgbd3H_N8Cp2njMJY';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// API URL for direct axios calls (as a fallback)
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Store conversation history in memory (in production, consider using a database)
const conversationHistory = {};

// Set up a cleanup interval to prevent memory leaks (every 24 hours)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_EXPIRY = 48 * 60 * 60 * 1000; // 48 hours

// Cleanup old sessions periodically
setInterval(() => {
  const now = Date.now();
  Object.keys(conversationHistory).forEach(sessionId => {
    const session = conversationHistory[sessionId];
    if (session.lastAccessed && (now - session.lastAccessed > SESSION_EXPIRY)) {
      delete conversationHistory[sessionId];
    }
  });
}, CLEANUP_INTERVAL);

// System prompt that provides context about the eInvoice system
const SYSTEM_PROMPT = `
You are an AI assistant for the Pinnacle eInvoice Portal system. Your purpose is to help users with their e-invoicing needs.

IMPORTANT: You have full knowledge of THIS specific eInvoice system implementation. You are not a general AI assistant - you are embedded directly in the Pinnacle eInvoice Portal and have knowledge of its specific features and UI. When users ask questions, give them exact steps based on the actual UI elements visible in the system.

About this eInvoice Portal:
- This is a middleware solution from Pinnacle that integrates business applications with LHDN's (Lembaga Hasil Dalam Negeri) e-Invoicing system in Malaysia
- It facilitates invoice data exchange while ensuring compliance with Malaysian tax regulations
- The system handles both outbound (sending) and inbound (receiving) invoices

System Interface Navigation:
- Dashboard: Main overview with statistics and recent activity
- Outbound: Page for managing invoices sent to others
- Inbound: Page for receiving and viewing invoices from suppliers
- Profile: Access Company profile and settings, including Company Details, Logo, etc.
- Settings: Manage personal information such as adding Profile picture, password, and notification settings, etc.
- Help: Detailed information about system features and usage
- Changelog: List of updates and changes to the system
- Logout: End the current session and log out

OUTBOUND INVOICE SUBMISSION PROCESS:
1. Navigate to the Outbound page by clicking "OUTBOUND" in the top navigation menu
2. The Outbound page shows statistics cards at the top (Total Invoices, Submitted, Rejected, Cancelled, Pending)
3. To submit a new invoice:
   a. Click the "Submit" button in the Actions column of an existing invoice record
   b. This will initiate the submission process to LHDN
   c. A confirmation dialog will appear to confirm submission
   d. After confirmation, the system will validate the invoice and submit it to LHDN
   e. The status will update to reflect the submission result

OUTBOUND PAGE ELEMENTS:
- Status filters at top: INVOICES, SUBMITTED, REJECTED, CANCELLED, PENDING
- Table columns: #, INVOICE NO./DOCUMENT, COMPANY, SUPPLIER, BUYER, FILE UPLOADED, DATE INFO, STATUS, SOURCE, TOTAL AMOUNT, ACTION
- The ACTION column has a "Submit" button for pending invoices
- You can also see "Schedule" options for some invoices

INBOUND INVOICE MANAGEMENT:
1. Navigate to the Inbound page by clicking "INBOUND" in the top navigation menu
2. The page shows statistics cards: Total Invoices, Valid, Invalid, Rejected, Cancelled, Queue
3. The main table shows all received invoices with their status
4. To refresh data from LHDN, click the "Refresh LHDN Data" button
5. To view details of an invoice, click the "View" button in the Actions column

INBOUND PAGE ELEMENTS:
- Status filters at top with counts: INVOICES, VALID, INVALID, REJECTED, CANCELLED, QUEUE
- Table columns: UUID, LONG ID, INTERNAL ID, SUPPLIER, RECEIVER, ISSUE DATE, RECEIVED DATE, STATUS, SOURCE, TOTAL SALES, ACTION
- The ACTION column has a "View" button to see invoice details
- "Export Selected" button for exporting data
- "Refresh LHDN Data" button to sync with LHDN

STATUS CODES:
- Submitted (Blue): Invoice has been submitted to LHDN
- Valid (Green): Invoice passed validation by LHDN
- Invalid (Red): Invoice failed validation
- Rejected (Red): Invoice was rejected
- Cancelled (Orange): Invoice was cancelled
- Pending (Yellow): Invoice is waiting to be submitted

USER PROFILE SETTINGS:
1. Click on your profile icon in the top right corner to access your profile settings
2. You can update your personal information, change your password, and manage notification settings
3. Make sure to keep your profile information up to date
4. You can also add a profile picture to personalize your account
5. Logout to end the current session and log out of the system
6. If you have any issues with your profile or settings, contact your system administrator

COMPANY PROFILE SETTINGS:
1. Click on your profile icon in the top right corner to access your profile settings
2. You can update your personal information, change your password, and manage company settings
3. Company settings include details like company name, address, tax ID, and other relevant information
4. Make sure to keep your profile and company information up to date
5. If you have any issues with your profile or company settings, contact your system administrator

HELP & SUPPORT:
- If you need help with the eInvoice system, click on the "Help" link in the top navigation menu
- The Help page provides detailed information about system features, navigation, and common tasks
- You can also find contact information for support and troubleshooting

CHANGELOG:
- To see the latest updates and changes to the eInvoice system, click on the "Changelog" link in the top navigation menu
- The Changelog page lists new features, bug fixes, and other improvements in the system
- Stay informed about system updates to make the most of the eInvoice portal

Remember:
You are an AI assistant with knowledge of the Pinnacle eInvoice system
When answering users, always refer to the exact UI elements and buttons they will see in the system. Be specific about which buttons to click and where they are located.
`;

// Helper function to validate session ID
function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && 
         sessionId.startsWith('session_') && 
         sessionId.length > 10 && 
         sessionId.length < 100;
}

// Helper function to sanitize user input
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  // Basic sanitization - remove any potentially harmful characters
  return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
             .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
             .trim();
}

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    // Validate inputs
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required and must be a string' 
      });
    }

    // Validate session ID
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid session ID is required' 
      });
    }
    
    // Sanitize user input
    const sanitizedMessage = sanitizeInput(message);
    
    // Initialize conversation history for this session if it doesn't exist
    if (!conversationHistory[sessionId]) {
      conversationHistory[sessionId] = {
        messages: [],
        lastAccessed: Date.now()
      };
    } else {
      // Update last accessed time
      conversationHistory[sessionId].lastAccessed = Date.now();
    }
    
    // Get conversation history for this session
    const history = conversationHistory[sessionId].messages;
    
    // Prepare the message content
    // Add context as first message if this is a new conversation
    const isNewConversation = history.length === 0;
    
    try {
      let textResponse;
      
      if (isNewConversation) {
        // For a new conversation, include the system prompt as context
        const chat = model.startChat({
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.95,
            topK: 40
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
          ]
        });
        
        // Send the system prompt first
        const result = await chat.sendMessage(SYSTEM_PROMPT + "\n\nUser's first message: " + sanitizedMessage);
        textResponse = result.response.text();
      } else {
        // For ongoing conversations, create a chat with history
        const chatHistory = history.map(msg => ({
          role: msg.role,
          parts: msg.parts.map(part => part.text)
        }));
        
        const chat = model.startChat({
          history: chatHistory,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.95,
            topK: 40
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
          ]
        });
        
        // Send the new message
        const result = await chat.sendMessage(sanitizedMessage);
        textResponse = result.response.text();
      }
      
      // Store the conversation in history
      if (isNewConversation) {
        // For new conversations, we've combined the system prompt with the user message
        // So we need to store the actual user message separately for the history
        conversationHistory[sessionId].messages.push({
          role: "user",
          parts: [{ text: sanitizedMessage }]
        });
      } else {
        // For ongoing conversations, add the message we just sent
        conversationHistory[sessionId].messages.push({
          role: "user",
          parts: [{ text: sanitizedMessage }]
        });
      }
      
      // Add the assistant's response to the conversation history
      conversationHistory[sessionId].messages.push({
        role: "model",
        parts: [{ text: textResponse }]
      });
      
      // Limit history to last 10 messages (5 exchanges) to avoid token limits
      if (conversationHistory[sessionId].messages.length > 10) {
        conversationHistory[sessionId].messages = conversationHistory[sessionId].messages.slice(-10);
      }

      return res.json({
        success: true,
        response: textResponse
      });
    } catch (aiError) {
      console.error('Gemini AI Client Error:', aiError);
      
      // Fall back to direct API call if the client library fails
      console.log('Falling back to direct API call...');
      
      // Construct the contents array for the API request
      let contents = [];
      
      if (isNewConversation) {
        // For a new conversation, include the system prompt as context in the first message
        contents = [
          {
            role: "user",
            parts: [{ 
              text: SYSTEM_PROMPT + "\n\nUser's first message: " + sanitizedMessage 
            }]
          }
        ];
      } else {
        // For ongoing conversations, add all previous messages
        // Then add the new user message
        contents = [
          ...history,
          {
            role: "user",
            parts: [{ text: sanitizedMessage }]
          }
        ];
      }
      
      // Call the Gemini API with conversation history
      const response = await axios.post(
        `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        {
          contents: contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.95,
            topK: 40
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
          ]
        },
        {
          timeout: 15000 // 15 second timeout
        }
      );

      // Extract the response text from Gemini
      const textResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
      
      // Store the conversation in history
      if (isNewConversation) {
        // For new conversations, we've combined the system prompt with the user message
        // So we need to store the actual user message separately for the history
        conversationHistory[sessionId].messages.push({
          role: "user",
          parts: [{ text: sanitizedMessage }]
        });
      } else {
        // For ongoing conversations, add the message we just sent
        conversationHistory[sessionId].messages.push({
          role: "user",
          parts: [{ text: sanitizedMessage }]
        });
      }
      
      // Add the assistant's response to the conversation history
      conversationHistory[sessionId].messages.push({
        role: "model",
        parts: [{ text: textResponse }]
      });
      
      // Limit history to last 10 messages (5 exchanges) to avoid token limits
      if (conversationHistory[sessionId].messages.length > 10) {
        conversationHistory[sessionId].messages = conversationHistory[sessionId].messages.slice(-10);
      }

      return res.json({
        success: true,
        response: textResponse
      });
    }
  } catch (error) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    
    // Provide more specific error messages based on the type of error
    let errorMessage = 'Failed to get response from AI assistant';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = 'The request to the AI service timed out. Please try again.';
    } else if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (error.response.status === 400) {
        errorMessage = 'Invalid request to AI service. Please try a different question.';
      } else if (error.response.status === 401 || error.response.status === 403) {
        errorMessage = 'Authentication error with AI service. Please contact support.';
      } else if (error.response.status >= 500) {
        errorMessage = 'AI service is currently unavailable. Please try again later.';
      }
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage = 'No response from AI service. Please check your connection and try again.';
    }
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.response?.data || error.message
    });
  }
});

// Add a route to clear conversation history
router.post('/clear-history', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid session ID is required' 
      });
    }
    
    // Reset the conversation history for this session
    if (conversationHistory[sessionId]) {
      conversationHistory[sessionId] = {
        messages: [],
        lastAccessed: Date.now()
      };
    }
    
    return res.json({
      success: true,
      message: 'Conversation history cleared'
    });
  } catch (error) {
    console.error('Clear History Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear conversation history',
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  return res.json({
    success: true,
    message: 'Gemini API service is running',
    timestamp: new Date().toISOString()
  });
});

// Add a function to provide accurate information about document cancellation
function getCancellationInstructions() {
    return `To cancel a submitted document in the Pinnacle eInvoice system:

1. Navigate to the Outbound page where you can see your submitted documents
2. Find the document you want to cancel in the table (it must have "Submitted" status)
3. If the document was recently submitted (within the cancellation time window), you'll see a "Cancel" button in the Actions column
4. Click the "Cancel" button
5. In the confirmation dialog, enter a reason for cancellation (this is required)
6. Click "Yes, cancel it" to confirm

Important notes:
- You can only cancel documents with "Submitted" status
- There is a time limit for cancellation after submission
- Once the time window expires, the Cancel button will no longer be available
- The cancellation cannot be undone

If you need help with cancellation or have issues with the process, please contact your system administrator.`;
}

module.exports = router; 