import React from 'react';
import { Alert } from 'react-native';
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
}): MenuConfig => ({
  title: 'Jogar',
  items: [
    {
      label: 'Jogar contra IA',
      icon: <Ionicons name="hardware-chip-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onQuickMatch,
    },
    {
      label: 'Jogar com amigo',
      icon: <Ionicons name="people" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: () => Alert.alert('Em breve', 'Esta funcionalidade está sendo desenvolvida.'),
    },
    {
      label: 'Quebra-cabeça',
      icon: <Ionicons name="grid" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: () => Alert.alert('Em breve', 'Esta funcionalidade está sendo desenvolvida.'),
    },
  ],
});

export const profileMenu = (handlers: {
  onProfile: () => void;
}): MenuConfig => ({
  title: 'Menu',
  items: [
    {
      label: 'Perfil',
      icon: <Ionicons name="person" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: handlers.onProfile,
    },
    {
      label: 'Jogo',
      icon: <Ionicons name="game-controller" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: () => Alert.alert('Em breve', 'Esta funcionalidade está sendo desenvolvida.'),
    },
    {
      label: 'Assinatura',
      icon: <Ionicons name="star" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: () => Alert.alert('Em breve', 'Esta funcionalidade está sendo desenvolvida.'),
    },
    {
      label: 'Configurações',
      icon: <Ionicons name="settings-outline" size={ICON_SIZE} color={ICON_COLOR} />,
      onPress: () => Alert.alert('Em breve', 'Esta funcionalidade está sendo desenvolvida.'),
    },
  ],
});
