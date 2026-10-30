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
  | 'stop_listening'
  | 'language_en'
  | 'language_hi'
  | 'slower'
  | 'faster'
  | 'normal_speed'
  | 'voice_mode'
  | 'screen_reader_mode'
  | 'handsfree_on'
  | 'handsfree_off'
  | 'retry_scanner'
  | 'close_confirmation'
  | 'read_history';

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
  if (/^(?:repeat|say that again|repeat that|repeat what you said|repeat what you say|repeat what you just said|what did you say|say it again|say that once more|again|dohrao|dobara bolo|phir se bolo|phir se repeat karo|jo kaha woh dobara bolo|aapne kya kaha|फिर से बोलो|दोहराओ)$/.test(value)) return 'repeat';
  if (/^(?:read my history|read history|tell me what happened|what happened this week|is hafte kya hua|pichle hafte ka hisab|history sunao|hisab sunao)$/.test(value)) return 'read_history';
  if (/^(?:(?:what is|check|read|tell me) (?:my )?(?:paypal )?(?:sandbox )?(?:account )?balance|paypal balance|paypal ka balance|balance batao|balance check karo|पेपैल बैलेंस बताओ)$/.test(value)) return 'check_paypal_balance';
  if (/^(?:stop listening|stop listening now|pause listening|sunna band karo|सुनना बंद करो)$/.test(value)) return 'stop_listening';
  if (/^(?:(?:speak|switch to|change to|use) english|english mein bolo|angrezi mein bolo|अंग्रेज़ी बोलो)$/.test(value)) return 'language_en';
  if (/^(?:(?:speak|switch to|change to|use) hindi|hindi mein bolo|हिंदी बोलो)$/.test(value)) return 'language_hi';
  if (/^(?:(?:speak|talk) (?:more )?slow(?:er|ly)|slow down|dheere bolo|धीरे बोलो)$/.test(value)) return 'slower';
  if (/^(?:(?:speak|talk) faster|speed up|tez bolo|तेज़ बोलो)$/.test(value)) return 'faster';
  if (/^(?:normal speed|speak normally|normal raftaar|samanya gati)$/.test(value)) return 'normal_speed';
  if (/^(?:(?:turn on|enable|switch to) voice mode|voice mode chalu karo)$/.test(value)) return 'voice_mode';
  if (/^(?:(?:turn on|enable|switch to) screen reader mode|screen reader mode chalu karo)$/.test(value)) return 'screen_reader_mode';
  if (/^(?:(?:turn on|enable|start) hands[- ]?free|hands[- ]?free chalu karo)$/.test(value)) return 'handsfree_on';
  if (/^(?:(?:turn off|disable|stop) hands[- ]?free|hands[- ]?free band karo)$/.test(value)) return 'handsfree_off';
  if (/^(?:try again|scan again|restart scanner|retry camera|dobara scan karo|camera dobara kholo)$/.test(value)) return 'retry_scanner';
  if (/^(?:done|close payment|close this screen|payment screen band karo)$/.test(value)) return 'close_confirmation';

  if (/^(?:(?:please )?(?:open|show|start|launch) (?:the )?(?:qr )?(?:scanner|camera|qr(?: code)?)|(?:scan|open|show) (?:the )?(?:qr )?(?:code|qr)|(?:qr )?scan(?:ner)? (?:kholo|kholiye|khol do|open karo|chalu karo)|(?:camera|scanner|qr) (?:kholo|kholiye|khol do|open karo|chalu karo)|(?:कैमरा|स्कैनर|क्यूआर स्कैनर) खोलो|क्यूआर स्कैन करो)$/.test(value)) return 'open_scanner';
  if (/^(?:(?:please )?(?:close|dismiss|cancel) (?:the )?(?:qr )?(?:scanner|camera)|(?:scanner|camera) (?:band karo|cancel karo)|स्कैनर बंद करो|कैमरा बंद करो)$/.test(value)) return 'close_scanner';

  if (/^(?:(?:please )?(?:open|show|go to|take me to) (?:me to )?(?:(?:my|our|the) )?(?:(?:recent )?(?:activity|transactions?|transaction history|payments?|payment history|hisab))(?: page| screen)?|(?:show me|tell me about) (?:(?:my|our|the) )?(?:(?:recent )?(?:activity|transactions?|transaction history|payments?|payment history|hisab))(?: page| screen)?|(?:activity|transactions|payments|hisab) kholo|(?:recent )?(?:activity|payments|transactions|hisab) dikhao|हिसाब दिखाओ|गतिविधि खोलो)$/.test(value)) return 'open_activity';
  if (/^(?:(?:please )?(?:open|show|go to) (?:the )?(?:family|guardian|family dashboard|family portal)|(?:family|guardian) (?:portal )?kholo|परिवार खोलो|परिवार डैशबोर्ड खोलो)$/.test(value)) return 'open_family';
  if (/^(?:(?:please )?(?:open|show|go to|change|modify) (?:the )?(?:app )?settings|settings kholo|settings page kholo|सेटिंग खोलो|सेटिंग्स खोलो)$/.test(value)) return 'open_settings';
  if (/^(?:close settings|dismiss settings|settings band karo|सेटिंग बंद करो|सेटिंग्स बंद करो)$/.test(value)) return 'close_settings';
  if (/^(?:(?:please )?(?:open|show|go to) (?:the )?(?:merchant|merchant portal|ravi cabs)|merchant portal kholo|merchant kholo|दुकानदार पोर्टल खोलो)$/.test(value)) return 'open_merchant';
  if (/^(?:(?:please )?(?:go )?(?:back|home)|return home|open (?:the )?(?:wallet|home)|wallet kholo|ghar jao|ghar wapas|wapas jao|main page par jao|वापस|वापस जाओ|घर जाओ|वॉलेट खोलो|मुख्य पेज खोलो)$/.test(value)) return /back|वापस/.test(value) ? 'go_back' : 'go_home';

  return null;
}
