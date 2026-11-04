"use client";

import { createContext } from "react";

/** Lets shared language controls dismiss their containing footer drawer. */
export const FooterNavigationContext = createContext<(() => void) | null>(null);
