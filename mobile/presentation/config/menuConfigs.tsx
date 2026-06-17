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
  onPlayWithFriend: () => void;
  onPuzzle: () => void;
}): MenuConfig => ({
  title: 'Jogar',
  items: [
    {
      label: 'Partida rápida',
      icon: <Ionicons name="flash" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onQuickMatch,
    },
    {
      label: 'Jogar com amigo',
      icon: <Ionicons name="people" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onPlayWithFriend,
    },
    {
      label: 'Quebra-cabeça',
      icon: <Ionicons name="grid" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onPuzzle,
    },
  ],
});

export const profileMenu = (handlers: {
  onProfile: () => void;
  onGame: () => void;
  onSubscription: () => void;
  onSettings: () => void;
}): MenuConfig => ({
  title: 'Perfil',
  items: [
    {
      label: 'Perfil',
      icon: <Ionicons name="person" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onProfile,
    },
    {
      label: 'Jogo',
      icon: <Ionicons name="game-controller" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onGame,
    },
    {
      label: 'Assinatura',
      icon: <Ionicons name="star" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onSubscription,
    },
    {
      label: 'Configurações',
      icon: <Ionicons name="settings" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onSettings,
    },
  ],
});

export const competitiveMenu = (handlers: {
  onCompetitions: () => void;
  onRanking: () => void;
  onAchievements: () => void;
  onStats: () => void;
}): MenuConfig => ({
  title: 'Competitivo',
  items: [
    {
      label: 'Competições',
      icon: <Ionicons name="trophy" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onCompetitions,
    },
    {
      label: 'Ranking',
      icon: <Ionicons name="podium" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onRanking,
    },
    {
      label: 'Conquistas',
      icon: <Ionicons name="medal" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onAchievements,
    },
    {
      label: 'Estatísticas',
      icon: <Ionicons name="bar-chart" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onStats,
    },
  ],
});
