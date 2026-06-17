import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import MenuBottomSheet from '../components/MenuBottomSheet';
import { competitiveMenu, gameMenu, MenuConfig, profileMenu } from '../config/menuConfigs';

type ActiveMenu = 'game' | 'profile' | 'competitive' | null;

export default function HomeScreenExample() {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const handleClose = useCallback(() => setActiveMenu(null), []);

  const currentMenu: MenuConfig | null = (() => {
    if (activeMenu === 'game') {
      return gameMenu({
        onQuickMatch: () => console.log('Partida rápida'),
        onPlayWithFriend: () => console.log('Jogar com amigo'),
        onPuzzle: () => console.log('Quebra-cabeça'),
      });
    }
    if (activeMenu === 'profile') {
      return profileMenu({
        onProfile: () => console.log('Perfil'),
        onGame: () => console.log('Jogo'),
        onSubscription: () => console.log('Assinatura'),
        onSettings: () => console.log('Configurações'),
      });
    }
    if (activeMenu === 'competitive') {
      return competitiveMenu({
        onCompetitions: () => console.log('Competições'),
        onRanking: () => console.log('Ranking'),
        onAchievements: () => console.log('Conquistas'),
        onStats: () => console.log('Estatísticas'),
      });
    }
    return null;
  })();

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.container}>
        <TouchableOpacity style={styles.button} onPress={() => setActiveMenu('game')}>
          <Text style={styles.buttonText}>Menu de Jogo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => setActiveMenu('profile')}>
          <Text style={styles.buttonText}>Menu de Perfil</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => setActiveMenu('competitive')}>
          <Text style={styles.buttonText}>Menu Competitivo</Text>
        </TouchableOpacity>
      </View>

      {currentMenu && (
        <MenuBottomSheet
          visible={activeMenu !== null}
          title={currentMenu.title}
          items={currentMenu.items}
          onClose={handleClose}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#151718',
    gap: 16,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: '#1B5F7A',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
