const joinForm = document.querySelector('#join-form');
const chatForm = document.querySelector('#chat-form');
const userNameInput = document.querySelector('#userName');
const spaceNameInput = document.querySelector('#spaceName');
const passwordInput = document.querySelector('#password');
const chatInput = document.querySelector('#chatText');
const sendButton = chatForm.querySelector('button');
const messages = document.querySelector('#messages');
const statusText = document.querySelector('#status');
const roomTitle = document.querySelector('#room-title');
const presence = document.querySelector('#presence');

let eventSource;
let session;

function setStatus(text) {
  statusText.textContent = text;
}

function addMessage(type, text, meta = '') {
  const item = document.createElement('article');
  item.className = `message ${type === 'system' ? 'system' : ''}`.trim();

  const body = document.createElement('p');
  body.textContent = text;
  body.style.margin = '0';
  item.append(body);

  if (meta) {
    const small = document.createElement('small');
    small.textContent = meta;
    item.append(small);
  }

  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function time(iso = new Date().toISOString()) {
  return new Date(iso).toLocaleTimeString();
}

async function joinSpace({ userName, spaceName, password }) {
  if (eventSource) {
    eventSource.close();
  }

  setStatus('Joining...');

  const joinResponse = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, spaceName, password })
  });

  const joinData = await joinResponse.json();
  if (!joinResponse.ok) {
    throw new Error(joinData.error || 'Failed to join space.');
  }

  session = { userName, spaceName, password, clientId: joinData.clientId };
  roomTitle.textContent = `Space: ${spaceName}`;
  chatInput.disabled = false;
  sendButton.disabled = false;
  messages.innerHTML = '';

  joinData.history.forEach((item) => {
    if (item.type === 'chat') {
      addMessage('chat', `${item.userName}: ${item.text}`, time(item.sentAt));
    } else {
      addMessage('system', item.text, time(item.sentAt));
    }
  });

  const query = new URLSearchParams(session);
  eventSource = new EventSource(`/api/stream?${query.toString()}`);

  eventSource.addEventListener('joined', () => {
    setStatus(`Connected as ${userName}`);
  });

  eventSource.addEventListener('presence', (event) => {
    const data = JSON.parse(event.data);
    presence.textContent = `People here: ${data.users.length ? data.users.join(', ') : 'none'}`;
  });

  eventSource.addEventListener('chat', (event) => {
    const data = JSON.parse(event.data);
    addMessage('chat', `${data.userName}: ${data.text}`, time(data.sentAt));
  });

  eventSource.addEventListener('system', (event) => {
    const data = JSON.parse(event.data);
    addMessage('system', data.text, time());
  });

  eventSource.onerror = () => {
    setStatus('Disconnected');
    chatInput.disabled = true;
    sendButton.disabled = true;
  };
}

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await joinSpace({
      userName: userNameInput.value.trim(),
      spaceName: spaceNameInput.value.trim(),
      password: passwordInput.value
    });
  } catch (error) {
    setStatus(error.message);
    addMessage('system', error.message);
  }
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !session) {
    return;
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...session, text })
  });

  if (response.ok) {
    chatInput.value = '';
    chatInput.focus();
  }
});
