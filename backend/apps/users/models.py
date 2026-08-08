import uuid

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from .managers import UserManager


def avatar_upload_path(instance, filename):
    ext = filename.rsplit(".", 1)[-1]
    return f"avatars/{instance.user_id}.{ext}"


class User(AbstractBaseUser, PermissionsMixin):
    """
    Modelo de usuário customizado.
    Autenticação via e-mail em vez de username (UC02 / UC03).
    """

    email = models.EmailField(unique=True, verbose_name="E-mail")
    full_name = models.CharField(max_length=150, verbose_name="Nome completo")

    is_active = models.BooleanField(default=True, verbose_name="Ativo")
    is_staff = models.BooleanField(default=False, verbose_name="Staff")
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        verbose_name = "Usuário"
        verbose_name_plural = "Usuários"
        ordering = ["-date_joined"]

    def __str__(self):
        return self.email


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    username = models.CharField(
        max_length=30,
        unique=True,
        null=True,
        blank=True,
        verbose_name="Nome de usuário",
    )
    avatar = models.ImageField(
        upload_to=avatar_upload_path, null=True, blank=True, verbose_name="Avatar"
    )
    bio = models.TextField(max_length=200, blank=True, default="", verbose_name="Bio")
    rating = models.IntegerField(default=1200, verbose_name="Rating ELO")
    # Null = ainda não passou pelo onboarding (RF do item 0.4). Contas
    # anteriores à feature são grandfathered pela migration 0010 (preenchida
    # com a data do deploy) — só contas novas caem no fluxo.
    onboarding_completed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Onboarding concluído em"
    )
    # Customer do Stripe fica no perfil (não na Subscription) para não
    # duplicar customer em compras futuras — o customer existe antes de
    # qualquer assinatura ser criada (item 0.1).
    stripe_customer_id = models.CharField(
        max_length=100, blank=True, default="", verbose_name="Stripe Customer"
    )
    games_played = models.IntegerField(default=0, verbose_name="Partidas jogadas")
    wins = models.IntegerField(default=0, verbose_name="Vitórias")
    losses = models.IntegerField(default=0, verbose_name="Derrotas")
    draws = models.IntegerField(default=0, verbose_name="Empates")

    class Meta:
        verbose_name = "Perfil"
        verbose_name_plural = "Perfis"

    def __str__(self):
        return f"Perfil de {self.user.email}"


def get_or_create_profile(user):
    """Ponto único de acesso a Profile a partir de um User autenticado.

    Um usuário autenticado sem Profile é um estado que o sistema deve
    autocorrigir (nunca aconteceria em cadastros novos — o signal
    `create_user_profile` cobre isso — mas contas anteriores a 27/jun/2026
    podem ter escapado; a migration 0013 já fez o backfill, este helper é a
    segunda camada de defesa). Nunca deixar um endpoint autenticado 500/404
    só porque o Profile está faltando.
    """
    profile, _created = Profile.objects.get_or_create(user=user)
    return profile


def get_or_create_profile_by_user_id(user_id, *, for_update=False):
    """Variante de `get_or_create_profile()` para os endpoints internos que só
    têm um `user_id` cru (webhook do Stripe, chamadas do node-api) — sem
    instanciar `User`, sob lock opcional (select_for_update, para os
    caminhos que já rodam dentro de uma transação com lock, ex.: resultado
    de partida).

    Confere a existência do User ANTES do get_or_create de propósito: uma
    FK inválida (user_id que não existe) levanta IntegrityError no INSERT,
    mas em Postgres, dentro de um savepoint aninhado, essa violação só é
    detectada no fechamento do savepoint — tarde demais para um
    try/except de escopo estreito. Checar a existência antes evita depender
    desse timing.

    Retorna None se `user_id` não corresponder a nenhum User (nada a
    autocorrigir nesse caso).
    """
    if not User.objects.filter(id=user_id).exists():
        return None
    qs = Profile.objects.select_for_update() if for_update else Profile.objects
    profile, _created = qs.get_or_create(user_id=user_id)
    return profile


class ModalityRating(models.Model):
    """
    Rating Glicko-2 de um perfil em uma modalidade (RF-PERF-02).

    Três valores por rating (não só um número, como no Elo): `rating` (força),
    `deviation` (RD — incerteza) e `volatility` (consistência). O período
    provisório das 20 primeiras partidas é derivado de `games_played` — não há
    campo extra: `is_provisional` é uma property.
    """

    MODALITY_BULLET = "bullet"
    MODALITY_BLITZ = "blitz"
    MODALITY_RAPID = "rapid"
    MODALITY_CHOICES = [
        ("bullet", "Bullet"),
        ("blitz", "Blitz"),
        ("rapid", "Rápido"),
    ]

    PROVISIONAL_GAMES = 20

    # Defaults do Glicko-2 (paper de Glickman) — seed uniforme para todos os
    # perfis, existentes e novos (o Elo antigo não é herdado; decisão do PM).
    DEFAULT_RATING = 1500.0
    DEFAULT_DEVIATION = 350.0
    DEFAULT_VOLATILITY = 0.06

    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="modality_ratings"
    )
    modality = models.CharField(max_length=6, choices=MODALITY_CHOICES)
    rating = models.FloatField(default=DEFAULT_RATING, verbose_name="Rating")
    deviation = models.FloatField(default=DEFAULT_DEVIATION, verbose_name="Desvio (RD)")
    volatility = models.FloatField(
        default=DEFAULT_VOLATILITY, verbose_name="Volatilidade"
    )
    games_played = models.IntegerField(default=0, verbose_name="Partidas jogadas")

    class Meta:
        unique_together = ("profile", "modality")
        verbose_name = "Rating por modalidade"
        verbose_name_plural = "Ratings por modalidade"

    @property
    def is_provisional(self):
        return self.games_played < self.PROVISIONAL_GAMES

    def __str__(self):
        return (
            f"{self.profile.user.email} [{self.modality}] "
            f"{self.rating:.0f} ±{self.deviation:.0f}"
        )


# Os 5 níveis da IA (wizard vs IA e Modo Campanha). Lista única, no módulo,
# porque `Game.ai_difficulty` e `CampaignProgress.level` são o MESMO
# vocabulário — e `Game` é declarado antes de `CampaignProgress`.
AI_LEVEL_CHOICES = [
    ("beginner", "Iniciante"),
    ("easy", "Fácil"),
    ("medium", "Médio"),
    ("hard", "Difícil"),
    ("master", "Mestre"),
]


class Game(models.Model):
    """
    A PARTIDA em si — o tabuleiro, não o extrato.

    `GameHistory` é o extrato de UM jogador (resultado, rating antes/depois):
    uma partida online gera DUAS linhas de GameHistory, uma para cada lado.
    `Game` é a partida propriamente dita, uma linha só, com os lances — é o que
    permite rever/analisar o jogo depois. As duas linhas de GameHistory
    apontam para o mesmo `Game` (ver `GameHistory.game`).

    Não substitui GameHistory: o extrato continua sendo a fonte de estatística
    e de rating (e continua existindo sozinho para as partidas antigas, que
    não têm lances gravados — `GameHistory.game` fica null nelas).
    """

    # Teto de lances gravados. Uma partida de xadrez real não passa disso
    # (a regra dos 75 lances encerra bem antes); o teto existe contra payload
    # abusivo/corrompido, e a partida NUNCA é rejeitada por causa dele — os
    # primeiros MAX_PLIES lances são guardados e `moves_truncated` marca o
    # corte. Guardamos o PREFIXO (não o sufixo) porque o replay só faz sentido
    # a partir de `initial_fen`.
    MAX_PLIES = 1000

    START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    MODE_AI = "ai"
    MODE_ONLINE = "online"
    MODE_CHOICES = [
        (MODE_AI, "vs IA"),
        (MODE_ONLINE, "Online"),
    ]

    # Resultado do TABULEIRO (quem venceu de brancas/pretas), não a
    # perspectiva de um jogador — "win"/"loss" só existem em GameHistory,
    # onde há um `user` para quem a vitória pertence.
    RESULT_WHITE = "white"
    RESULT_BLACK = "black"
    RESULT_DRAW = "draw"
    RESULT_CHOICES = [
        (RESULT_WHITE, "Brancas"),
        (RESULT_BLACK, "Pretas"),
        (RESULT_DRAW, "Empate"),
    ]

    # Vocabulário único de fim de partida, compartilhado com o node-api
    # (socket/index.js) e com o app (GameOverModal.GameEndReason). O app
    # também diz "threefold" onde o node diz "repetition"; a normalização de
    # entrada mora em `normalize_termination`, para o banco ter um termo só.
    TERMINATION_CHOICES = [
        ("checkmate", "Xeque-mate"),
        ("stalemate", "Afogamento"),
        ("repetition", "Repetição"),
        ("insufficient", "Material insuficiente"),
        ("draw", "Empate"),
        ("agreement", "Acordo"),
        ("resign", "Desistência"),
        ("abandon", "Abandono"),
        ("timeout", "Tempo esgotado"),
    ]

    COLOR_WHITE = "w"
    COLOR_BLACK = "b"
    COLOR_CHOICES = [(COLOR_WHITE, "Brancas"), (COLOR_BLACK, "Pretas")]

    # Identificador público, para URL/compartilhamento de partida. UUID
    # SEPARADO da PK (que segue BigAutoField): a PK sequencial continua barata
    # para FK/índice, e o id exposto não vaza volume de partidas do produto.
    public_id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, verbose_name="ID público"
    )
    # Id da partida no node-api (chave `game:{id}` do Redis). É a CHAVE DE
    # IDEMPOTÊNCIA do registro online: dois finais de partida concorrentes
    # (ex.: desistência no mesmo instante em que o timer de abandono dispara)
    # chegam com o mesmo external_id, e o segundo vira no-op em vez de
    # duplicar histórico e aplicar Glicko-2 duas vezes.
    # Null (não ""), para várias partidas sem external_id conviverem sob o
    # unique — partida vs IA não tem id de servidor.
    external_id = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        unique=True,
        verbose_name="ID no node-api",
    )
    mode = models.CharField(max_length=6, choices=MODE_CHOICES)
    modality = models.CharField(
        max_length=6,
        choices=ModalityRating.MODALITY_CHOICES,
        default=ModalityRating.MODALITY_BLITZ,
    )

    # SET_NULL, não CASCADE: uma partida é de DOIS jogadores. Se um exclui a
    # conta, a partida tem de continuar na biblioteca do outro — por isso os
    # nomes abaixo são gravados como snapshot no momento do registro, e não
    # lidos da FK na hora de exibir.
    white_player = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="games_as_white",
    )
    black_player = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="games_as_black",
    )
    white_name = models.CharField(max_length=150, blank=True, default="")
    black_name = models.CharField(max_length=150, blank=True, default="")

    # Só em partida vs IA. `ai_color` é a cor que a IA jogou (o humano jogou a
    # outra) — sem ela não dá para saber de que lado o adversário estava.
    ai_difficulty = models.CharField(
        max_length=8,
        choices=AI_LEVEL_CHOICES,
        null=True,
        blank=True,
        verbose_name="Nível da IA",
    )
    ai_color = models.CharField(
        max_length=1, choices=COLOR_CHOICES, null=True, blank=True
    )

    # Lances em SAN, na ordem jogada ("e4", "e5", "Nf3", ...). SAN e não UCI
    # porque é o que o app e o node-api já produzem (chess.js `move().san`) e
    # o que um PGN precisa.
    moves = models.JSONField(default=list, blank=True, verbose_name="Lances (SAN)")
    # Lances REALMENTE jogados — pode ser maior que len(moves) quando houve
    # truncamento. É o número honesto do tamanho da partida.
    ply_count = models.IntegerField(default=0, verbose_name="Lances jogados")
    moves_truncated = models.BooleanField(
        default=False, verbose_name="Lances truncados"
    )

    initial_fen = models.CharField(max_length=100, blank=True, default=START_FEN)
    final_fen = models.CharField(max_length=100, blank=True, default="")
    result = models.CharField(max_length=5, choices=RESULT_CHOICES)
    termination = models.CharField(
        max_length=20, choices=TERMINATION_CHOICES, blank=True, default=""
    )
    # Base do relógio em segundos; null = sem relógio (só vs IA).
    time_control = models.IntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = "Partida"
        verbose_name_plural = "Partidas"
        ordering = ["-ended_at"]
        indexes = [
            models.Index(fields=["white_player", "-ended_at"]),
            models.Index(fields=["black_player", "-ended_at"]),
        ]

    def __str__(self):
        return f"{self.white_name or '?'} × {self.black_name or '?'} ({self.result})"


def normalize_moves(raw):
    """Sanitiza a lista de lances recebida do cliente/node-api.

    Devolve `(moves, ply_count, truncated)`. Nunca levanta: um payload torto
    vira lista vazia, porque perder os lances é ruim mas perder a PARTIDA
    (rating, histórico, estatística) por causa deles seria pior.

    `ply_count` é o total recebido, mesmo quando `moves` foi truncado em
    `Game.MAX_PLIES` — ver o comentário do teto no model.
    """
    if not isinstance(raw, list):
        return [], 0, False
    # SAN mais longo do xadrez tem ~7 caracteres ("Qa1xb2#", "exd8=Q+"); 12 dá
    # folga sem deixar entrar texto arbitrário no banco.
    sans = [m[:12] for m in raw if isinstance(m, str) and m]
    total = len(sans)
    return sans[: Game.MAX_PLIES], total, total > Game.MAX_PLIES


_TERMINATION_ALIASES = {"threefold": "repetition"}
_TERMINATION_VALUES = {value for value, _label in Game.TERMINATION_CHOICES}


def normalize_termination(raw):
    """Traduz o motivo de fim recebido para o vocabulário do `Game`.

    Valor desconhecido vira "" (campo em branco) em vez de ser gravado cru:
    um termo livre no banco vira uma segunda gramática que ninguém consegue
    consultar depois.
    """
    if not isinstance(raw, str):
        return ""
    value = _TERMINATION_ALIASES.get(raw, raw)
    return value if value in _TERMINATION_VALUES else ""


class GameHistory(models.Model):
    RESULT_WIN = "win"
    RESULT_LOSS = "loss"
    RESULT_DRAW = "draw"
    RESULT_CHOICES = [
        ("win", "Vitória"),
        ("loss", "Derrota"),
        ("draw", "Empate"),
    ]

    MODE_AI = "ai"
    MODE_ONLINE = "online"
    MODE_CHOICES = [
        ("ai", "vs IA"),
        ("online", "Online"),
    ]

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="game_history"
    )
    # A partida (tabuleiro + lances) que originou este extrato. Null para
    # TODO o histórico anterior a esta migration — não há como recuperar os
    # lances de partidas já jogadas, então não existe migração de dados: as
    # linhas antigas ficam null e a tela de histórico simplesmente não oferece
    # "rever a partida" nelas.
    #
    # SET_NULL (e não CASCADE): apagar a partida nunca pode apagar o extrato
    # de quem jogou — o rating e a estatística do jogador dependem dele.
    game = models.ForeignKey(
        "Game",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="history_entries",
        verbose_name="Partida",
    )
    opponent_name = models.CharField(max_length=150, blank=True, default="")
    result = models.CharField(max_length=4, choices=RESULT_CHOICES)
    mode = models.CharField(max_length=6, choices=MODE_CHOICES)
    # Default "blitz" cobre o histórico pré-Glicko-2: partidas online eram
    # sempre 5 min (blitz) e jogos vs IA antigos não têm dado de tempo
    # (decisão do PM em 2026-07-07: tudo vira blitz).
    modality = models.CharField(
        max_length=6,
        choices=ModalityRating.MODALITY_CHOICES,
        default=ModalityRating.MODALITY_BLITZ,
    )
    rating_before = models.IntegerField()
    rating_after = models.IntegerField()
    # Fonte do split de estatísticas do Perfil (decisão D2): partidas
    # ranqueadas (com relógio contra humanos) vs. "vs IA e Amistosas".
    # False = partida vs IA (qualquer) ou sem relógio: entra no histórico e
    # nas estatísticas, mas NUNCA alterou o Glicko-2 (decisão D1).
    rated = models.BooleanField(
        default=True,
        help_text=(
            "False para partidas vs IA e sem relógio — contam no histórico e "
            "nas estatísticas, mas não alteram o rating."
        ),
    )
    COLOR_WHITE = "w"
    COLOR_BLACK = "b"
    COLOR_CHOICES = [(COLOR_WHITE, "Brancas"), (COLOR_BLACK, "Pretas")]
    # Cor que ESTE usuário jogou nesta partida. Nullable de propósito: o
    # histórico anterior a esta migration não tem como saber a cor (ela só
    # existia no hash `game:` do Redis, com TTL de 2h, já expirado).
    # Null = desconhecida.
    #
    # Partidas vs IA passaram a informar a cor junto com os lances (o app
    # manda `player_color`); apps antigos continuam sem mandar. ATENÇÃO ao
    # consumo previsto — balancear cor no pareamento da busca rápida — que
    # precisa filtrar `mode="online"`: a cor jogada contra a IA é escolha do
    # próprio usuário no wizard e não diz nada sobre o pareamento.
    color = models.CharField(
        max_length=1,
        choices=COLOR_CHOICES,
        null=True,
        blank=True,
        verbose_name="Cor jogada",
    )
    played_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Histórico de partida"
        verbose_name_plural = "Histórico de partidas"
        ordering = ["-played_at"]

    def __str__(self):
        return (
            f"{self.user.email} {self.result} ({self.mode}) — {self.played_at:%Y-%m-%d}"
        )


class CampaignProgress(models.Model):
    """
    Progressão do Modo Campanha vs IA (épico Modo Campanha, PR 1): uma linha
    por (perfil, nível) — mesmo padrão do ModalityRating. 3 vitórias no
    nível desbloqueiam o próximo e concedem o selo do nível dominado.

    Escolhido ARMAZENADO em vez de DERIVADO de GameHistory porque
    GameHistory não tem coluna de dificuldade estruturada — só um texto
    livre em opponent_name ("IA Iniciante" etc.), montado a partir do valor
    bruto recebido em AiGameResultView. Derivar exigiria parsear esse texto
    (frágil); armazenado incrementa a partir do valor bruto, que já está em
    memória no momento do registro (ver record_campaign_win()).
    """

    LEVEL_BEGINNER = "beginner"
    LEVEL_EASY = "easy"
    LEVEL_MEDIUM = "medium"
    LEVEL_HARD = "hard"
    LEVEL_MASTER = "master"
    # Mesmo vocabulário de `Game.ai_difficulty` — uma lista só (ver
    # AI_LEVEL_CHOICES no topo do módulo).
    LEVEL_CHOICES = AI_LEVEL_CHOICES
    # Ordem sequencial dos tiers (espec fechada) — usada para achar o
    # "próximo nível" a desbloquear. Mestre não tem próximo.
    LEVEL_ORDER = [LEVEL_BEGINNER, LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, LEVEL_MASTER]

    WINS_TO_UNLOCK = 3

    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="campaign_progress"
    )
    level = models.CharField(max_length=8, choices=LEVEL_CHOICES)
    wins = models.IntegerField(default=0, verbose_name="Vitórias")
    unlocked = models.BooleanField(default=False, verbose_name="Desbloqueado")
    unlocked_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Desbloqueado em"
    )
    badge_awarded = models.BooleanField(default=False, verbose_name="Selo concedido")
    badge_awarded_at = models.DateTimeField(
        null=True, blank=True, verbose_name="Selo concedido em"
    )

    class Meta:
        unique_together = ("profile", "level")
        verbose_name = "Progresso de Campanha"
        verbose_name_plural = "Progressos de Campanha"

    @classmethod
    def next_level(cls, level):
        """Próximo tier na ordem da campanha, ou None (Mestre não tem próximo,
        mas ainda concede selo — a conquista final)."""
        try:
            return cls.LEVEL_ORDER[cls.LEVEL_ORDER.index(level) + 1]
        except (ValueError, IndexError):
            return None

    def __str__(self):
        return f"{self.profile.user.email} [{self.level}] {self.wins} vitórias"


class CampaignWinLog(models.Model):
    """
    Amarra o incremento da campanha ao GameHistory que o originou — garante
    idempotência: reprocessar/reenviar o resultado da mesma partida (mesmo
    game_history_id) não conta a vitória duas vezes, porque a constraint
    OneToOne em `game` faz o segundo get_or_create ser no-op.
    """

    game = models.OneToOneField(
        GameHistory, on_delete=models.CASCADE, related_name="campaign_win_log"
    )
    level = models.CharField(max_length=8, choices=CampaignProgress.LEVEL_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Vitória de campanha [{self.level}] — game #{self.game_id}"


def ensure_campaign_progress(profile):
    """Garante as 5 linhas de CampaignProgress do perfil, cada uma no estado
    inicial correto (Iniciante desbloqueado, demais travados) se ainda não
    existirem. Idempotente (get_or_create por nível) — chamada no signal de
    criação de Profile e defensivamente na leitura, mesmo padrão de
    resiliência do get_or_create_profile()."""
    now = timezone.now()
    for level in CampaignProgress.LEVEL_ORDER:
        is_beginner = level == CampaignProgress.LEVEL_BEGINNER
        CampaignProgress.objects.get_or_create(
            profile=profile,
            level=level,
            defaults={
                "unlocked": is_beginner,
                "unlocked_at": now if is_beginner else None,
            },
        )


def record_campaign_win(profile, level, game_history_id):
    """Registra uma vitória vs IA na campanha, atrelada ao GameHistory que a
    originou (game_history_id) — idempotente: chamar de novo com o mesmo
    game_history_id é no-op (CampaignWinLog.game é OneToOne).

    Ao atingir WINS_TO_UNLOCK vitórias no nível: concede o selo do nível
    (uma vez só, `badge_awarded` trava) e desbloqueia o próximo nível, se
    houver (Mestre concede selo mas não desbloqueia nada — é o fim da
    campanha).
    """
    if level not in CampaignProgress.LEVEL_ORDER:
        return None

    _log, created = CampaignWinLog.objects.get_or_create(
        game_id=game_history_id, defaults={"level": level}
    )
    if not created:
        return None

    progress, _ = CampaignProgress.objects.select_for_update().get_or_create(
        profile=profile, level=level
    )
    progress.wins += 1
    update_fields = ["wins"]

    if progress.wins >= CampaignProgress.WINS_TO_UNLOCK and not progress.badge_awarded:
        progress.badge_awarded = True
        progress.badge_awarded_at = timezone.now()
        update_fields += ["badge_awarded", "badge_awarded_at"]

        next_level = CampaignProgress.next_level(level)
        if next_level:
            (
                next_progress,
                _,
            ) = CampaignProgress.objects.select_for_update().get_or_create(
                profile=profile, level=next_level
            )
            if not next_progress.unlocked:
                next_progress.unlocked = True
                next_progress.unlocked_at = timezone.now()
                next_progress.save(update_fields=["unlocked", "unlocked_at"])

    progress.save(update_fields=update_fields)
    return progress


class Friendship(models.Model):
    STATUS_PENDING = "pending"
    STATUS_ACCEPTED = "accepted"
    STATUS_CHOICES = [
        ("pending", "Pendente"),
        ("accepted", "Aceito"),
    ]
    requester = models.ForeignKey(
        User, related_name="sent_requests", on_delete=models.CASCADE
    )
    receiver = models.ForeignKey(
        User, related_name="received_requests", on_delete=models.CASCADE
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("requester", "receiver")
        verbose_name = "Amizade"
        verbose_name_plural = "Amizades"

    def __str__(self):
        return f"{self.requester.email} → {self.receiver.email} ({self.status})"
