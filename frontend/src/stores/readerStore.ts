import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_DEFAULT = 18;

interface ReaderState {
  fontSize: number;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set, get) => ({
      fontSize: FONT_SIZE_DEFAULT,

      increaseFontSize: () => {
        const { fontSize } = get();
        if (fontSize < FONT_SIZE_MAX) {
          set({ fontSize: fontSize + FONT_SIZE_STEP });
        }
      },

      decreaseFontSize: () => {
        const { fontSize } = get();
        if (fontSize > FONT_SIZE_MIN) {
          set({ fontSize: fontSize - FONT_SIZE_STEP });
        }
      },
    }),
    {
      name: 'reader-preferences',
      partialize: (state) => ({ fontSize: state.fontSize }),
    }
  )
);

export { FONT_SIZE_MIN, FONT_SIZE_MAX };
