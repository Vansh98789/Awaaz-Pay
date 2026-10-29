export type VoiceCommand =
  | 'open_scanner'
  | 'open_activity'
  | 'open_family'
  | 'open_settings'
  | 'open_merchant'
  | 'go_home'
  | 'go_back'
  | 'close_scanner'
  | 'close_settings'
  | 'repeat'
  | 'help'
  | 'check_paypal_balance'
  | 'stop_listening';

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,!?;:।]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const value = normalize(text);

  if (/^(?:help|madad|options|commands|what can i say|how do i use this|kya bolu|kya keh sakta hu|madad karo|मदद|सहायता)$/.test(value)) return 'help';
  if (/^(?:repeat|say that again|repeat that|again|dohrao|dobara bolo|phir se bolo|दोहराओ|फिर से बोलो)$/.test(value)) return 'repeat';
  if (/^(?:(?:what is|check|read|tell me) (?:my )?paypal (?:sandbox )?(?:account )?balance|paypal balance|paypal ka balance|paypal balance batao|paypal ka balance batao|पेपैल बैलेंस बताओ)$/.test(value)) return 'check_paypal_balance';
  if (/^(?:stop listening|stop listening now|pause listening|sunna band karo|सुनना बंद करो)$/.test(value)) return 'stop_listening';

  if (/^(?:(?:please )?(?:open|show|start|launch) (?:the )?(?:qr )?(?:scanner|camera|qr(?: code)?)|(?:scan|open|show) (?:the )?(?:qr )?(?:code|qr)|(?:qr )?scan(?:ner)? (?:kholo|kholiye|khol do|open karo|chalu karo)|(?:camera|scanner|qr) (?:kholo|kholiye|khol do|open karo|chalu karo)|(?:कैमरा|स्कैनर|क्यूआर स्कैनर) खोलो|क्यूआर स्कैन करो)$/.test(value)) return 'open_scanner';
  if (/^(?:(?:please )?(?:close|dismiss|cancel) (?:the )?(?:qr )?(?:scanner|camera)|(?:scanner|camera) (?:band karo|cancel karo)|स्कैनर बंद करो|कैमरा बंद करो)$/.test(value)) return 'close_scanner';

  if (/^(?:(?:please )?(?:open|show|read|go to) (?:my )?(?:activity|recent activity|history|transactions|recent transactions|payments|recent payments|hisab)|(?:activity|history|transactions|payments|hisab) kholo|(?:recent )?(?:activity|payments|transactions|history|hisab) dikhao|हिसाब दिखाओ|गतिविधि खोलो)$/.test(value)) return 'open_activity';
  if (/^(?:(?:please )?(?:open|show|go to) (?:the )?(?:family|guardian|family dashboard)|(?:family|guardian) kholo|परिवार खोलो|परिवार डैशबोर्ड खोलो)$/.test(value)) return 'open_family';
  if (/^(?:(?:please )?(?:open|show|go to) (?:the )?settings|settings kholo|सेटिंग खोलो|सेटिंग्स खोलो)$/.test(value)) return 'open_settings';
  if (/^(?:close settings|dismiss settings|settings band karo|सेटिंग बंद करो|सेटिंग्स बंद करो)$/.test(value)) return 'close_settings';
  if (/^(?:(?:please )?(?:open|show|go to) (?:the )?(?:merchant|merchant portal|ravi cabs)|merchant portal kholo|merchant kholo|दुकानदार पोर्टल खोलो)$/.test(value)) return 'open_merchant';
  if (/^(?:(?:please )?(?:go )?(?:back|home)|return home|open (?:the )?(?:wallet|home)|wallet kholo|ghar jao|ghar wapas|wapas jao|main page par jao|वापस|वापस जाओ|घर जाओ|वॉलेट खोलो|मुख्य पेज खोलो)$/.test(value)) return /back|वापस/.test(value) ? 'go_back' : 'go_home';

  return null;
}
