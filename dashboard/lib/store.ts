"use client";

import { create } from "zustand";

type UiState = {
  deviceSearch: string;
  setDeviceSearch: (value: string) => void;
};

export const useUiStore = create<UiState>((set) => ({
  deviceSearch: "",
  setDeviceSearch: (value) => set({ deviceSearch: value })
}));
