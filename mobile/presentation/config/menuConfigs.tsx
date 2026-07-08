import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MenuItem } from '../components/MenuBottomSheet';

const ICON_SIZE = 22;
const ICON_COLOR = '#0a7ea4';

export type MenuConfig = {
  title: string;
  items: MenuItem[];
};

export const gameMenu = (handlers: {
  onQuickMatch: () => void;
  onQuickOnline: () => void;
  onPrivateRoom: () => void;
}): MenuConfig => ({
  title: 'Jogar',
  items: [
    {
      label: 'Jogar contra IA',
      icon: <Ionicons name="hardware-chip-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onQuickMatch,
    },
    {
      label: 'Partida Rápida',
      icon: <Ionicons name="flash-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onQuickOnline,
    },
    {
      label: 'Jogar com Amigos',
      icon: <Ionicons name="people-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onPrivateRoom,
    },
  ],
});

export const profileMenu = (handlers: {
  onProfile: () => void;
  onLeaderboard: () => void;
  onSubscription: () => void;
  onSettings: () => void;
}): MenuConfig => ({
  title: 'Menu',
  items: [
    {
      label: 'Perfil',
      icon: <Ionicons name="person-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onProfile,
    },
    {
      label: 'Classificação',
      icon: <Ionicons name="trophy-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onLeaderboard,
    },
    {
      label: 'Premium',
      icon: <Ionicons name="star-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onSubscription,
    },
    {
      label: 'Configurações',
      icon: <Ionicons name="settings-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onSettings,
    },
  ],
});
