import { appConfig } from "../config/app-config.js";

const memory = new Map();

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`${appConfig.sessionKey}.${key}`);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return memory.get(key) ?? fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${appConfig.sessionKey}.${key}`, JSON.stringify(value));
    } catch {
      memory.set(key, value);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`${appConfig.sessionKey}.${key}`);
    } catch {
      memory.delete(key);
    }
  },
};
