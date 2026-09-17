'use client';

import { useCreatorFollows } from '@/lib/creator-follow-store';
import { useNotifications } from '@/lib/notifications-store';
import { Check, Plus } from 'lucide-react';

interface FollowButtonProps {
  creatorId: string;
  creatorName: string;
}

export function FollowButton({ creatorId, creatorName }: FollowButtonProps) {
  const { isFollowing, toggleFollowCreator } = useCreatorFollows();
  const { addNotification } = useNotifications();
  const following = isFollowing(creatorId);

  const handleClick = () => {
    const nowFollowing = toggleFollowCreator(creatorId);
    if (nowFollowing) {
      addNotification(
        `You followed ${creatorName}`,
        `You'll get notified whenever ${creatorName} publishes a new Bag.`
      );
    }
  };

  return (
    <button className={`follow-btn ${following ? 'following' : ''}`} onClick={handleClick}>
      {following ? <Check size={13} /> : <Plus size={13} />}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
