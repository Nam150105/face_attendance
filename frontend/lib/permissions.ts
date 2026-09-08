"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

export type Action = "view" | "create" | "edit" | "delete";
export type PermissionMap = Record<string, Record<Action, boolean>>;

/**
 * One fetch per page load, shared by every component that asks. Hiding a button
 * the account may not use is courtesy, not protection — the endpoint behind it
 * checks the same table again and refuses on its own.
 */
let pending: Promise<PermissionMap> | null = null;

function fetchPermissions(): Promise<PermissionMap> {
  if (!pending) {
    pending = api
      .myScreens()
      .then((result) => result.permissions ?? {})
      .catch(() => ({}) as PermissionMap);
  }
  return pending;
}

export function usePermissions(screen: string): Record<Action, boolean> {
  // Assume nothing until the answer arrives, so a button never flashes into
  // view for somebody who is about to be told they cannot use it.
  const [actions, setActions] = useState<Record<Action, boolean>>({
    view: false,
    create: false,
    edit: false,
    delete: false,
  });

  useEffect(() => {
    let live = true;
    void fetchPermissions().then((map) => {
      if (live && map[screen]) {
        setActions(map[screen]);
      }
    });
    return () => {
      live = false;
    };
  }, [screen]);

  return actions;
}
