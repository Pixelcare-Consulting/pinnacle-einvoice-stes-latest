document.addEventListener('DOMContentLoaded', function() {
    // Reset the chat session on page load to ensure fresh context
    localStorage.removeItem('chatSessionId');
    // Load saved position settings if available
    loadPositionSettings();
    initChatAssistant();
});

// Configuration options for the chat assistant
const chatConfig = {
    position: {
        bottom: 1,
        right: 20
    },
};

// Load position settings from localStorage
function loadPositionSettings() {
    const savedPosition = localStorage.getItem('chatAssistantPosition');
    if (savedPosition) {
        try {
            const position = JSON.parse(savedPosition);
            if (position && typeof position.bottom === 'number' && typeof position.right === 'number') {
                chatConfig.position = position;
            }
        } catch (e) {
            console.error('Error loading chat position settings:', e);
        }
    }
}

// Save position settings to localStorage
function savePositionSettings() {
    localStorage.setItem('chatAssistantPosition', JSON.stringify(chatConfig.position));
}

function initChatAssistant() {
    console.log('Initializing chat assistant...');
    // Create chat container if it doesn't exist
    if (!document.querySelector('.ai-chat-container')) {
        createChatInterface();
    }
    
    // Get references to DOM elements after ensuring they exist
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatHeader = document.querySelector('.chat-header');
    const chatMessages = document.querySelector('.chat-messages');
    const chatInput = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#send-message');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    const toggleQuestionsBtn = document.querySelector('.toggle-questions-btn');
    
    console.log('Toggle Questions Button:', toggleQuestionsBtn);
    
    // Apply position from configuration
    applyPositionConfig();
    
    // Generate a session ID for this chat session
    if (!localStorage.getItem('chatSessionId')) {
        localStorage.setItem('chatSessionId', generateSessionId());
    }
    
    // Toggle questions button
    if (toggleQuestionsBtn) {
        console.log('Adding click event listener to toggle questions button');
        toggleQuestionsBtn.addEventListener('click', function(e) {
            console.log('Toggle questions button clicked');
            togglePredefinedQuestions(e);
        });
        
        // Initialize questions container
        const questionsContainer = document.querySelector('.predefined-questions-container');
        if (questionsContainer) {
            console.log('Initializing questions container');
            questionsContainer.style.display = 'none';
            // Add initial questions
            addPredefinedQuestions();
        }
    } else {
        console.error('Toggle questions button not found in DOM');
    }
    
    // Set initial toggle button visibility - only if the element exists
    if (chatToggleBtn) {
        if (chatContainer.classList.contains('open')) {
            chatToggleBtn.style.display = 'none';
        } else {
            chatToggleBtn.style.display = 'flex';
        }
    }
    
    // Toggle chat open/closed when header is clicked
    if (chatHeader) {
        chatHeader.addEventListener('click', function(e) {
            // Don't toggle if clicking on the action buttons
            if (e.target.closest('.header-actions')) {
                return;
            }
            toggleChat();
        });
    }
    
    // Chat toggle button (mobile)
    if (chatToggleBtn) {
        chatToggleBtn.addEventListener('click', function() {
            toggleChat();
        });
    }
    
    // Close button
    const closeButton = document.querySelector('.chat-close');
    if (closeButton) {
        closeButton.addEventListener('click', function() {
            chatContainer.classList.remove('open');
            if (chatToggleBtn) {
                chatToggleBtn.style.display = 'flex';
            }
        });
    }
    
    // Minimize button
    const minimizeButton = document.querySelector('.chat-minimize');
    if (minimizeButton) {
        minimizeButton.addEventListener('click', function() {
            chatContainer.classList.remove('open');
            if (chatToggleBtn) {
                chatToggleBtn.style.display = 'flex';
            }
        });
    }
    
    // Reset button
    const resetButton = document.querySelector('.chat-reset');
    if (resetButton) {
        resetButton.addEventListener('click', resetChat);
    }
    
    // Send button
    if (sendButton) {
        sendButton.addEventListener('click', function() {
            sendMessage();
        });
    }
    
    // Input field - enable button when text is entered
    if (chatInput && sendButton) {
        chatInput.addEventListener('input', function() {
            sendButton.disabled = this.value.trim() === '';
        });
    }
    
    // Input field - send on Enter key
    if (chatInput) {
        chatInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey && sendButton && !sendButton.disabled) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
    
    // Initialize with welcome message
    resetChat();
}

// Apply position configuration to the chat elements
function applyPositionConfig() {
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    
    if (!chatContainer && !chatToggleBtn) return;
    
    // Apply position to chat container with a slight delay to ensure smooth transitions
    setTimeout(() => {
        if (chatContainer) {
            chatContainer.style.bottom = `${chatConfig.position.bottom}px`;
            chatContainer.style.right = `${chatConfig.position.right}px`;
        }
        
        // Apply same position to toggle button
        if (chatToggleBtn) {
            chatToggleBtn.style.bottom = `${chatConfig.position.bottom}px`;
            chatToggleBtn.style.right = `${chatConfig.position.right}px`;
        }
    }, 50);
}

// Function to set a new position for the chat assistant
function setChatPosition(bottom, right) {
    chatConfig.position.bottom = bottom;
    chatConfig.position.right = right;
    applyPositionConfig();
    savePositionSettings();
}

function createChatInterface() {
    console.log('Creating chat interface...');
    const chatHTML = `
        <div class="ai-chat-container">
            <div class="chat-header">
                <h5><i class="fas fa-robot"></i>Pinnacle Assistant</h5>
                <div class="header-actions">
                    <button class="chat-reset" title="Reset conversation"><i class="fas fa-redo-alt"></i></button>
                    <button class="chat-minimize" title="Minimize chat"><i class="fas fa-minus"></i></button>
                    <button class="chat-close" title="Close chat"><i class="fas fa-times"></i></button>
                </div>
            </div>
            <div class="chat-messages"></div>
            <div class="chat-input">
                <div class="input-group-chat">
                    <input type="text" id="chat-input" placeholder="Ask about Pinnacle e-Invoice Portal..." aria-label="Chat message input" />
                    <button id="send-message" disabled title="Send message"><i class="fas fa-paper-plane"></i></button>
                </div>
                <button class="toggle-questions-btn" title="Show/hide common questions">
                    <i class="fas fa-question-circle"></i> Common Questions
                </button>
                <div class="predefined-questions-container"></div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', chatHTML);
    console.log('Chat interface created');
    
    // Add a context menu to the chat header for position adjustment
    const chatHeader = document.querySelector('.chat-header');
    chatHeader.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showPositionConfigPanel(e.clientX, e.clientY);
    });
}

// Show a simple position configuration panel
function showPositionConfigPanel(x, y) {
    // Remove any existing config panel
    const existingPanel = document.querySelector('.chat-config-panel');
    if (existingPanel) {
        existingPanel.remove();
    }
    
    // Create a new config panel
    const panel = document.createElement('div');
    panel.className = 'chat-config-panel';
    
    // Adjust position to ensure panel is visible within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate position to keep panel in viewport
    let posX = x;
    let posY = y;
    
    // Panel dimensions (estimated)
    const panelWidth = 220;
    const panelHeight = 180;
    
    // Adjust X if too close to right edge
    if (posX + panelWidth > viewportWidth - 20) {
        posX = viewportWidth - panelWidth - 20;
    }
    
    // Adjust Y if too close to bottom edge
    if (posY + panelHeight > viewportHeight - 20) {
        posY = viewportHeight - panelHeight - 20;
    }
    
    panel.style.position = 'fixed';
    panel.style.left = `${posX}px`;
    panel.style.top = `${posY}px`;
    
    panel.innerHTML = `
        <div style="margin-bottom: 12px; font-weight: 600; color: #1e3a8a;">Adjust Position</div>
        <div style="margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px; font-size: 13px;">Bottom (px):</label>
            <input type="number" id="chat-pos-bottom" value="${chatConfig.position.bottom}" style="width: 100%;">
        </div>
        <div style="margin-bottom: 14px;">
            <label style="display: block; margin-bottom: 5px; font-size: 13px;">Right (px):</label>
            <input type="number" id="chat-pos-right" value="${chatConfig.position.right}" style="width: 100%;">
        </div>
        <div style="display: flex; justify-content: space-between; gap: 8px;">
            <button id="chat-pos-apply" style="flex: 1;">Apply</button>
            <button id="chat-pos-cancel" style="flex: 1;">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(panel);
    
    // Add event listeners
    document.getElementById('chat-pos-apply').addEventListener('click', function() {
        const bottom = parseInt(document.getElementById('chat-pos-bottom').value) || 20;
        const right = parseInt(document.getElementById('chat-pos-right').value) || 20;
        setChatPosition(bottom, right);
        panel.remove();
    });
    
    document.getElementById('chat-pos-cancel').addEventListener('click', function() {
        panel.remove();
    });
    
    // Close panel when clicking outside
    document.addEventListener('click', function closePanel(e) {
        if (!panel.contains(e.target)) {
            panel.remove();
            document.removeEventListener('click', closePanel);
        }
    });
}

function toggleChat() {
    const chatContainer = document.querySelector('.ai-chat-container');
    const chatToggleBtn = document.querySelector('.chat-toggle-btn');
    
    if (!chatContainer) return;
    
    chatContainer.classList.toggle('open');
    
    // Hide toggle button when chat is open, show when minimized
    if (chatToggleBtn) {
        if (chatContainer.classList.contains('open')) {
            chatToggleBtn.style.display = 'none';
            setTimeout(() => {
                const chatInput = document.querySelector('#chat-input');
                if (chatInput) chatInput.focus();
                // Ensure messages are scrolled to bottom when opening
                scrollToBottom();
            }, 300); // Wait for animation to complete
        } else {
            // Use a slight delay to avoid visual glitches during transition
            setTimeout(() => {
                chatToggleBtn.style.display = 'flex';
            }, 100);
        }
    }
}

function sendMessage(predefinedMessage = null) {
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    
    if (!chatInput || !sendButton) return;
    
    // Get message from predefined or input
    const message = predefinedMessage || chatInput.value.trim();
    
    // Don't send empty messages
    if (!message) return;
    
    // Disable input and button while processing
    chatInput.disabled = true;
    sendButton.disabled = true;
    
    // Add user message to chat
    addMessage('user', message);
    
    // Clear input if it was a manually typed message
    if (!predefinedMessage) {
        chatInput.value = '';
    }
    
    // Show typing indicator
    showTypingIndicator();
    
    // Check for specific questions about cancellation
    const cancellationQuestions = [
        "how do i cancel",
        "cancel a submitted document",
        "cancelling documents",
        "cancel an invoice",
        "how to cancel",
        "can i cancel"
    ];
    
    // If the message is about cancellation, provide the correct information
    if (cancellationQuestions.some(q => message.toLowerCase().includes(q))) {
        // Hide typing indicator after a short delay to simulate thinking
        setTimeout(() => {
            hideTypingIndicator();
            
            const cancellationResponse = `
                <h4 style="margin-top: 0; color: #1e3a8a;">Document Cancellation Process</h4>
                
                <p>To cancel a submitted document in Pinnacle eInvoice:</p>
                
                <ol style="padding-left: 20px; margin-bottom: 10px;">
                    <li>Go to the <strong>Outbound</strong> section</li>
                    <li>Find the document you want to cancel</li>
                    <li>Click the <strong>Actions</strong> button (three dots)</li>
                    <li>Select <strong>Cancel Document</strong> from the dropdown</li>
                    <li>Provide a cancellation reason when prompted</li>
                    <li>Click <strong>Submit</strong> to send the cancellation request</li>
                </ol>
                
                <div style="background-color: #f0f0f0; padding: 10px; margin: 10px 0; border-radius: 6px; font-size: 13px; border-left: 3px solid #1e3a8a;">
                    <strong>Note:</strong> Only available for recently submitted documents within the time window.
                </div>
            `;
            
            addMessage('assistant', cancellationResponse);
            
            // Re-enable input and button
            chatInput.disabled = false;
            chatInput.focus();
            sendButton.disabled = chatInput.value.trim() === '';
        }, 1500);
        
        return;
    }
    
    // Get session ID
    const sessionId = localStorage.getItem('chatSessionId') || generateSessionId();
    
    // Send to API
    fetch('/api/gemini/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            message,
            sessionId 
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Hide typing indicator
        hideTypingIndicator();
        
        if (data.success) {
            addMessage('assistant', data.response);
        } else {
            addMessage('assistant', 'Sorry, I encountered an error. Please try again later.');
            console.error('API Error:', data.error || data.message);
        }
        
        // Re-enable input and button
        chatInput.disabled = false;
        chatInput.focus();
        sendButton.disabled = chatInput.value.trim() === '';
    })
    .catch(error => {
        hideTypingIndicator();
        addMessage('assistant', 'Sorry, I couldn\'t connect to the server. Please try again later.');
        console.error('Fetch Error:', error);
        
        // Re-enable input and button
        chatInput.disabled = false;
        chatInput.focus();
        sendButton.disabled = chatInput.value.trim() === '';
    });
}

function resetChat() {
    const chatMessages = document.querySelector('.chat-messages');
    if (!chatMessages) return;
    
    chatMessages.innerHTML = '';
    
    // Generate a new session ID
    sessionId = generateSessionId();
    // Add welcome message
    const welcomeMessage = `Hello! I'm your Pinnacle eInvoice Assistant.

I can help you with:
• Submitting invoices
• Validating documents
• Cancelling submissions
• Troubleshooting system errors

What would you like help with today?`;
    
    addMessage('assistant', welcomeMessage);
    
    // Add predefined questions if the container exists
    const questionsContainer = document.querySelector('.predefined-questions-container');
    if (questionsContainer) {
        addPredefinedQuestions();
    }
    
    // Clear input
    const chatInput = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#send-message');
    
    if (chatInput) {
        chatInput.value = '';
    }
    
    if (sendButton) {
        sendButton.disabled = true;
    }
}

function addPredefinedQuestions() {
    console.log('addPredefinedQuestions called');
    const container = document.querySelector('.predefined-questions-container');
    
    if (!container) {
        console.error('Predefined questions container not found');
        return;
    }
    
    // Clear existing questions
    container.innerHTML = '';
    
    // Add title to the questions container
    const title = document.createElement('div');
    title.style.fontSize = '14px';
    title.style.fontWeight = '600';
    title.style.color = '#1e3a8a';
    title.style.marginBottom = '12px';
    title.style.padding = '0 4px';
    title.textContent = 'Frequently Asked Questions';
    container.appendChild(title);
    
    const categories = [
        {
            name: 'Document Submission',
            icon: 'fa-file-upload',
            questions: [
                'How do I submit an Invoice Document to LHDN from Pinnacle e-Invoice Portal?',
                'What happens during the LHDN submission process from Pinnacle e-Invoice Portal?',
                'How do I check my document submission status in Pinnacle e-Invoice Portal?',
                'How do I cancel a submitted document in Pinnacle e-Invoice Portal?',
                'What do the different status colors mean in the outbound table in Pinnacle e-Invoice Portal?'
            ]
        },
        {
            name: 'Validation & Errors',
            icon: 'fa-check-circle',
            questions: [
                'Why was my document rejected by LHDN from Pinnacle e-Invoice Portal?',
                'How do I fix document validation errors in Pinnacle e-Invoice Portal?',
                'What are common validation issues with Excel files in Pinnacle e-Invoice Portal?',
                'How do I validate my Excel file before LHDN submission in Pinnacle e-Invoice Portal?',
                'What should I do if I get a system error during submission in Pinnacle e-Invoice Portal?'
            ]
        },
        {
            name: 'Company Settings',
            icon: 'fa-building',
            questions: [
                'How do I update my company profile in Pinnacle e-Invoice Portal?',
                'How do I configure my LHDN credentials in Pinnacle e-Invoice Portal?',
                'How do I update my company logo or profile image in Pinnacle e-Invoice Portal?',
                'Where can I find my company TIN and BRN information in Pinnacle e-Invoice Portal?',
                'How do I set up Outbound/Inbound configuration paths in Pinnacle e-Invoice Portal?'
            ]
        },
        {
            name: 'Inbound & Reports',
            icon: 'fa-file-import',
            questions: [
                'How do I view invoice details in the inbound section of Pinnacle e-Invoice Portal?',
                'How do I export invoice data to CSV from Pinnacle e-Invoice Portal?',
                'How do I check if my LHDN data is up to date in Pinnacle e-Invoice Portal?',
                'What do the document type icons mean in the inbound table of Pinnacle e-Invoice Portal?',
                'How do I copy invoice information from the system in Pinnacle e-Invoice Portal?'
            ]
        },
        {
            name: 'System Configuration',
            icon: 'fa-cogs',
            questions: [
                'How do I set up my LHDN certificate on Pinnacle e-Invoice Portal?',
                'How do I test my LHDN connection on Pinnacle e-Invoice Portal?',
                'How do I update my access token on Pinnacle e-Invoice Portal?',
                'How do I configure network paths for documents on Pinnacle e-Invoice Portal?',
                'How do I validate network path accessibility on Pinnacle e-Invoice Portal?'
            ]
        },
        {
            name: 'Audit Trail',
            icon: 'fa-history',
            questions: [
                'How do I use the Audit Trail feature on Pinnacle e-Invoice Portal?',
                'What information is tracked in the Audit Trail on Pinnacle e-Invoice Portal?',
                'How do I filter activities in the Audit Trail on Pinnacle e-Invoice Portal?',
                'How do I export Audit Trail data from Pinnacle e-Invoice Portal?',
                'What do the different action types mean in the Audit Trail on Pinnacle e-Invoice Portal?'
            ]
        }
    ];
    // Create and append each category
    categories.forEach((category, index) => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'question-category';
        categoryDiv.setAttribute('data-icon', category.icon);
        
        // Add animation delay based on index
        categoryDiv.style.animation = `fadeInUp 0.3s ease forwards ${index * 0.1}s`;
        categoryDiv.style.opacity = '0';
        
        const categoryTitle = document.createElement('h4');
        categoryTitle.textContent = category.name;
        categoryDiv.appendChild(categoryTitle);
        
        // Create buttons for each question with hover effect
        category.questions.forEach(question => {
            const button = document.createElement('button');
            button.className = 'question-button';
            button.textContent = question;
            
            // Add click handler
            button.addEventListener('click', () => {
                // Animate button when clicked
                button.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    button.style.transform = '';
                }, 100);
                
                sendMessage(question);
                // Hide questions after selection
                container.style.display = 'none';
                document.querySelector('.toggle-questions-btn').classList.remove('active');
            });
            
            categoryDiv.appendChild(button);
        });
        
        container.appendChild(categoryDiv);
    });
    
    // Add animation keyframes if they don't exist
    if (!document.querySelector('#chat-animations')) {
        const style = document.createElement('style');
        style.id = 'chat-animations';
        style.textContent = `
            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

function addMessage(type, text) {
    const messagesContainer = document.querySelector('.chat-messages');
    if (!messagesContainer) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `message-${type}`);
    
    // Set user profile picture if it's a user message
    if (type === 'user') {
        // Get user profile picture from session storage or use default
        const navbarData = JSON.parse(sessionStorage.getItem('navbarData') || '{}');
        const profilePic = navbarData?.user?.profilePicture || '/assets/img/default-avatar.png';
        messageDiv.style.setProperty('--user-profile-pic', `url(${profilePic})`);
    }
    
    // Sanitize the text to remove any CSS code or unwanted formatting
    let cleanText = text;
    
    // More comprehensive sanitization for CSS-like content
    // Remove CSS property patterns
    cleanText = cleanText.replace(/("color:[^"]+"|"margin[^"]+"|"font[^"]+"|"display[^"]+"|"align[^"]+"|"flex[^"]+")/g, '');
    cleanText = cleanText.replace(/(color:[^;]+;|margin[^;]+;|font[^;]+;|display[^;]+;|align[^;]+;|flex[^;]+;)/g, '');
    
    // Remove specific CSS values that might appear in the text
    cleanText = cleanText.replace(/(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|rgba\([^)]+\))/g, '');
    
    // Remove any remaining CSS-like patterns
    cleanText = cleanText.replace(/([a-z\-]+):\s*([^;]+);/g, '');
    
    // Format the message text - clean up excessive newlines and spaces
    const formattedText = formatMessage(cleanText);
    
    // Create message content
    const messageContent = document.createElement('div');
    messageContent.classList.add('message-content');
    
    // Format numbered lists and steps better
    let enhancedText = formattedText;
    
    // Enhance step formatting (1. Step, 2. Step, etc.)
    enhancedText = enhancedText.replace(/(\d+)\.\s+([A-Z][^.]+?)(\.|\:)/g, '<strong>$1. $2$3</strong>');
    
    // Highlight important terms in quotes
    enhancedText = enhancedText.replace(/"([^"]+)"/g, '<em>"$1"</em>');
    
    // Format action items or buttons in quotes
    enhancedText = enhancedText.replace(/"([A-Z]+)"/g, '<strong>"$1"</strong>');
    
    // Format *exact* text with emphasis
    enhancedText = enhancedText.replace(/\*exact\*/g, '<em>exact</em>');
    
    // Format validation fields with blue highlight
    enhancedText = enhancedText.replace(/\[([^\]]+)\]/g, '<span style="color:#1e3a8a;font-weight:600;">$1</span>');
    
    messageContent.innerHTML = enhancedText;
    
    // Add timestamp
    const timestamp = document.createElement('div');
    timestamp.classList.add('message-time');
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Append elements
    messageDiv.appendChild(messageContent);
    messageDiv.appendChild(timestamp);
    messagesContainer.appendChild(messageDiv);
    
    scrollToBottom();
}

function formatMessage(text) {
    // First, sanitize any CSS-like content that might be in the text
    let formatted = text.replace(/("color:[^"]+"|"margin[^"]+"|"font[^"]+"|"display[^"]+")/g, '');
    formatted = formatted.replace(/(color:[^;]+;|margin[^;]+;|font[^;]+;|display[^;]+;)/g, '');
    
    // Special handling for validation error messages with double asterisks
    formatted = formatted.replace(/\*\*What kind of document/g, '<strong>What kind of document</strong>');
    formatted = formatted.replace(/\*\*What is the specific error message\?\*\*/g, '<strong>What is the specific error message?</strong>');
    formatted = formatted.replace(/\*\*What type of data is involved\?\*\*/g, '<strong>What type of data is involved?</strong>');
    formatted = formatted.replace(/\*\*What are the validation rules\?\*\*/g, '<strong>What are the validation rules?</strong>');
    
    // Handle markdown-style formatting
    // Bold text (** **) - must be processed before single asterisks
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Italic text (* *)
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Remove excessive newlines (more than 2 in a row)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    // Clean up extra spaces
    formatted = formatted.replace(/[ ]{2,}/g, ' ');
    
    // Format numbered steps better
    formatted = formatted.replace(/(\d+)\.\s+/g, '\n$1. ');
    
    // Format code blocks properly
    formatted = formatted.replace(/```([^`]+)```/g, function(match, code) {
        return '<pre><code>' + code.trim() + '</code></pre>';
    });
    
    // Format inline code
    formatted = formatted.replace(/`([^`]+)`/g, function(match, code) {
        return '<code>' + code + '</code>';
    });
    
    // Add paragraph breaks for better readability
    formatted = formatted.replace(/\n\n/g, '</p><p>');
    formatted = '<p>' + formatted + '</p>';
    formatted = formatted.replace(/<p><\/p>/g, '');
    
    return formatted;
}

function showTypingIndicator() {
    const chatMessages = document.querySelector('.chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.classList.add('typing-indicator');
    typingDiv.innerHTML = '<span></span><span></span><span></span>';
    typingDiv.id = 'typing-indicator';
    chatMessages.appendChild(typingDiv);
    scrollToBottom();
}

function hideTypingIndicator() {
    const typingIndicator = document.querySelector('#typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function scrollToBottom() {
    const chatMessages = document.querySelector('.chat-messages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function generateSessionId() {
    // Generate a random session ID
    return 'session_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Function to toggle predefined questions visibility
function togglePredefinedQuestions(e) {
    console.log('togglePredefinedQuestions called', e);
    
    if (e) {
        e.preventDefault(); // Prevent default button behavior
        e.stopPropagation(); // Prevent event bubbling
    }
    
    const questionsContainer = document.querySelector('.predefined-questions-container');
    const toggleButton = document.querySelector('.toggle-questions-btn');
    
    console.log('Questions container:', questionsContainer);
    console.log('Toggle button:', toggleButton);
    
    if (!questionsContainer || !toggleButton) {
        console.error('Required elements not found');
        return;
    }
    
    // Force initial display style if not set
    if (questionsContainer.style.display === '') {
        console.log('Initial display style not set, defaulting to none');
        questionsContainer.style.display = 'none';
    }
    
    const isVisible = questionsContainer.style.display === 'block';
    console.log('Current visibility:', isVisible);
    
    // Toggle visibility
    questionsContainer.style.display = isVisible ? 'none' : 'block';
    toggleButton.classList.toggle('active', !isVisible);
    console.log('New display state:', questionsContainer.style.display);
    
    // Always ensure questions are added when showing the container
    if (!isVisible) {
        console.log('Adding/refreshing predefined questions');
        addPredefinedQuestions();
        // Ensure the container is visible after adding questions
        questionsContainer.style.display = 'block';
        // Scroll to show the questions
        setTimeout(scrollToBottom, 100);
    }
} 