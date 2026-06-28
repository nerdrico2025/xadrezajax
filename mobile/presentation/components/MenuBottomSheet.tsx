import React, { useCallback, useEffect } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAG_CLOSE_THRESHOLD = 80;
const OPEN_CONFIG = { duration: 420, easing: Easing.out(Easing.cubic) };
const CLOSE_CONFIG = { duration: 250, easing: Easing.in(Easing.cubic) };

export type MenuItem = {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
};

type MenuBottomSheetProps = {
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
  title?: string;
};

const DragHandle = React.memo(() => (
  <View style={styles.dragHandle} />
));

const MenuItemRow = React.memo(({ item, onClose }: { item: MenuItem; onClose: () => void }) => {
  const handlePress = useCallback(() => {
    onClose();
    item.onPress();
  }, [item, onClose]);

  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={handlePress}
      activeOpacity={0.65}
    >
      <View style={styles.menuItemIcon}>{item.icon}</View>
      <Text style={styles.menuItemLabel}>{item.label}</Text>
    </TouchableOpacity>
  );
});

const MenuBottomSheet = React.memo(
  ({ visible, items, onClose, title }: MenuBottomSheetProps) => {
    const translateY = useSharedValue(SCREEN_HEIGHT);
    const overlayOpacity = useSharedValue(0);

    const open = useCallback(() => {
      overlayOpacity.value = withTiming(1, { duration: 320 });
      translateY.value = withTiming(0, OPEN_CONFIG);
    }, [overlayOpacity, translateY]);

    const close = useCallback(() => {
      overlayOpacity.value = withTiming(0, { duration: 250 });
      translateY.value = withTiming(SCREEN_HEIGHT, CLOSE_CONFIG, () => {
        runOnJS(onClose)();
      });
    }, [overlayOpacity, translateY, onClose]);

    useEffect(() => {
      if (visible) open();
    }, [visible, open]);

    const panGesture = Gesture.Pan()
      .onUpdate((e) => {
        if (e.translationY > 0) {
          translateY.value = e.translationY;
          overlayOpacity.value = withTiming(
            1 - e.translationY / SCREEN_HEIGHT,
            { duration: 0 }
          );
        }
      })
      .onEnd((e) => {
        if (e.translationY > DRAG_CLOSE_THRESHOLD || e.velocityY > 800) {
          runOnJS(close)();
        } else {
          translateY.value = withTiming(0, OPEN_CONFIG);
          overlayOpacity.value = withTiming(1, { duration: 150 });
        }
      });

    const sheetStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: translateY.value }],
    }));

    const overlayStyle = useAnimatedStyle(() => ({
      opacity: overlayOpacity.value,
    }));

    if (!visible) return null;

    return (
      <Modal transparent statusBarTranslucent visible={visible} animationType="none">
        <View style={styles.root}>
          <Animated.View style={[styles.overlay, overlayStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          </Animated.View>

          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.sheet, sheetStyle]}>
              <DragHandle />
              {title && <Text style={styles.title}>{title}</Text>}
              <View style={styles.itemsContainer}>
                {items.map((item) => (
                  <MenuItemRow key={item.label} item={item} onClose={close} />
                ))}
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  dragHandle: {
    alignSelf: 'center',
    backgroundColor: '#444',
    borderRadius: 3,
    height: 4,
    marginBottom: 16,
    width: 40,
  },
  title: {
    color: '#9BA1A6',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  itemsContainer: {
    gap: 4,
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  menuItemIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  menuItemLabel: {
    color: '#ECEDEE',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default MenuBottomSheet;
