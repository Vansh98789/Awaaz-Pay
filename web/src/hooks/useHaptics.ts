// Haptics conforming strictly to the blind-first spec:
// listening start [30]; understood [20,40,20]; confirmed [40,60,40]; blocked [350]; error [80,60,80,60,80]

export const triggerHaptic = (
  type: 'listeningStart' | 'understood' | 'confirmed' | 'blocked' | 'error'
) => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }

  try {
    switch (type) {
      case 'listeningStart':
        navigator.vibrate([30]);
        break;
      case 'understood':
        navigator.vibrate([20, 40, 20]);
        break;
      case 'confirmed':
        navigator.vibrate([40, 60, 40]);
        break;
      case 'blocked':
        navigator.vibrate([350]);
        break;
      case 'error':
        navigator.vibrate([80, 60, 80, 60, 80]);
        break;
    }
  } catch {
    // Vibration silently ignored if not supported by device/OS
  }
};
