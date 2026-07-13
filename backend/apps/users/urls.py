from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    AiGameResultView,
    ChangePasswordView,
    ChessTokenObtainPairView,
    DeleteAccountView,
    FriendListView,
    FriendRequestActionView,
    GameHistoryView,
    GameResultView,
    GoogleLoginView,
    LeaderboardView,
    MeView,
    OnboardingView,
    PasswordResetVerifyCodeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PendingRequestsView,
    ProfileView,
    RegisterView,
    SendFriendRequestView,
)

app_name = "users"

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", ChessTokenObtainPairView.as_view(), name="login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "password-reset/verify-code/",
        PasswordResetVerifyCodeView.as_view(),
        name="password-reset-verify-code",
    ),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("me/", MeView.as_view(), name="me"),
    path("google/", GoogleLoginView.as_view(), name="google-login"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("onboarding/", OnboardingView.as_view(), name="onboarding"),
    path("game/result/", GameResultView.as_view(), name="game-result"),
    path("game/ai-result/", AiGameResultView.as_view(), name="game-ai-result"),
    path("game/history/", GameHistoryView.as_view(), name="game-history"),
    path("leaderboard/", LeaderboardView.as_view(), name="leaderboard"),
    path("password/change/", ChangePasswordView.as_view(), name="password-change"),
    path("account/", DeleteAccountView.as_view(), name="account-delete"),
    path("friends/", FriendListView.as_view(), name="friends-list"),
    path("friends/request/", SendFriendRequestView.as_view(), name="friends-request"),
    path("friends/requests/", PendingRequestsView.as_view(), name="friends-pending"),
    path("friends/<int:pk>/", FriendRequestActionView.as_view(), name="friends-action"),
]
