import { logger } from "@/lib/logger";
import { useState, useEffect, useCallback, useRef } from "react";

export const useMessageSpeech = (text: string) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const updateVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      window.speechSynthesis.cancel();
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = useCallback(() => {
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsSpeaking(true);
    } else {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      // Try to find a more natural sounding voice
      // Priority: Google US English -> Microsoft Zira -> Samantha -> Default
      const preferredVoice = voices.find(
        (voice) =>
          voice.name.includes("Google US English") ||
          voice.name.includes("Microsoft Zira") ||
          voice.name.includes("Samantha"),
      );

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      // Adjust rate and pitch for more natural sound
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };

      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") {
          setIsSpeaking(false);
          setIsPaused(false);
          return;
        }
        logger.error("Speech synthesis error:", event.error, event);
        setIsSpeaking(false);
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
  }, [text, isPaused, voices]);

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    setIsPaused(true);
    setIsSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  return { isSpeaking, isPaused, speak, pause, stop };
};
