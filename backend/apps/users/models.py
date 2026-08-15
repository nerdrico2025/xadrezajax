import uuid
from datetime import timedelta

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


ANALYSIS_CLASSIFICATIONS = (
    "brilliant",
    "best",
    "good",
    "inaccuracy",
    "mistake",
    "blunder",
)


def normalize_analysis_moves(raw):
    """Sanitiza a lista de lances analisados vinda do node-api.

    Mesma disciplina de `normalize_moves`: nunca levanta, corta no teto de
    análise e devolve `(moves, total, truncated)`. O que chega aqui é interno
    (autenticado por segredo compartilhado), mas continua sendo JSON solto
    indo para o banco — campo desconhecido é descartado, e não gravado por
    inércia, para o formato do JSON não virar terra de ninguém.
    """
    if not isinstance(raw, list):
        return [], 0, False

    cleaned = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        classification = item.get("classification")
        cleaned.append(
            {
                "ply": _as_int(item.get("ply")),
                "san": str(item.get("san", ""))[:12],
                "eval_cp": _as_int(item.get("eval_cp")),
                "cp_loss": _as_int(item.get("cp_loss")),
                "classification": (
                    classification
                    if classification in ANALYSIS_CLASSIFICATIONS
                    else None
                ),
                "best_move_san": str(item.get("best_move_san", ""))[:12],
                "is_only_move": bool(item.get("is_only_move")),
                "is_book": bool(item.get("is_book")),
            }
        )

    total = len(cleaned)
    limit = GameAnalysis.MAX_ANALYZED_PLIES
    return cleaned[:limit], total, total > limit


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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


class GameAnalysis(models.Model):
    """
    Análise pós-jogo de uma partida (Fase 2) — o que o Stockfish achou de cada
    lance, depois que a partida acabou.

    UMA linha por partida, não uma por lance: o detalhe vive em `moves`
    (JSON) e o resumo em colunas indexáveis. A tela de revisão sempre lê a
    partida inteira de uma vez (1 query em vez de 80 linhas), e as colunas de
    resumo cobrem as agregações que o produto vai querer (precisão média,
    contagem por classificação) sem multiplicar linha. Se um dia algo exigir
    SQL por lance, dá para derivar de `moves`; o caminho contrário — agregar
    80 linhas para desenhar uma tela — seria pago desde o primeiro dia.

    É TAMBÉM A FILA DE TRABALHO. O node-api não recebe ordem de ninguém: ele
    pergunta ao Django se há análise pendente (ver InternalAnalysisNextView).
    A fila morar no Postgres, e não na memória do node-api, é o que faz uma
    análise interrompida por deploy voltar a ser processada em vez de sumir.
    """

    STATUS_PENDING = "pendente"
    STATUS_RUNNING = "analisando"
    STATUS_DONE = "pronta"
    STATUS_FAILED = "falhou"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pendente"),
        (STATUS_RUNNING, "Analisando"),
        (STATUS_DONE, "Pronta"),
        (STATUS_FAILED, "Falhou"),
    ]

    # Versão das FAIXAS de classificação e do método. Mudou limiar ou
    # profundidade → incrementa, e as análises antigas ficam identificáveis
    # como "feitas com outra régua". Sem isto, uma tela mostraria números de
    # duas réguas diferentes sem ninguém perceber.
    PARAMS_VERSION = 1

    # Teto de lances analisados, MENOR que o teto de 1000 plies do `Game`:
    # aquele protege o banco, este protege a CPU. 1000 posições a 400ms são
    # ~6min40 de engine; 300 plies (150 lances de cada lado) cobrem qualquer
    # partida normal e limitam o pior caso a ~2min.
    MAX_ANALYZED_PLIES = 300

    # Tentativas antes de desistir de uma partida problemática — senão ela
    # ocuparia a engine em loop, para sempre.
    MAX_ATTEMPTS = 3

    game = models.OneToOneField(
        Game,
        on_delete=models.PROTECT,
        related_name="analysis",
        verbose_name="Partida",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING
    )

    # ── Parâmetros, para o resultado ser reprodutível ────────────────────
    params_version = models.IntegerField(default=PARAMS_VERSION)
    engine_depth = models.IntegerField(null=True, blank=True)
    engine_movetime = models.IntegerField(null=True, blank=True)
    engine_id = models.CharField(max_length=60, blank=True, default="")

    # ── Resumo, indexável ────────────────────────────────────────────────
    # Precisão em % (0-100), derivada da perda média — nula enquanto a
    # análise não terminou.
    white_accuracy = models.FloatField(null=True, blank=True)
    black_accuracy = models.FloatField(null=True, blank=True)
    white_avg_loss = models.IntegerField(null=True, blank=True)
    black_avg_loss = models.IntegerField(null=True, blank=True)
    # {"white": {"brilliant": 0, ...}, "black": {...}}
    counts = models.JSONField(default=dict, blank=True)
    # Lance que decidiu a partida. NULO É RESULTADO LEGÍTIMO: partida ganha
    # do começo ao fim, ou derrota construída em dez imprecisões sem nenhum
    # lance culpado, não têm momento decisivo — e apontar um que não existe é
    # pior do que não apontar nada.
    turning_point_ply = models.IntegerField(null=True, blank=True)

    # ── Detalhe ──────────────────────────────────────────────────────────
    # Uma entrada por lance: {ply, san, eval_cp, cp_loss, classification,
    # best_move_san, is_only_move, is_book}.
    moves = models.JSONField(default=list, blank=True)
    # Quantos lances foram de fato analisados — menor que `Game.ply_count`
    # quando bateu no MAX_ANALYZED_PLIES.
    analyzed_plies = models.IntegerField(default=0)

    # ── Operação da fila ─────────────────────────────────────────────────
    attempts = models.IntegerField(default=0)
    # Prazo do "aluguel" do trabalho pelo node-api. Vencido = o worker morreu
    # no meio (deploy, queda) e o trabalho volta para a fila. É o que impede
    # uma análise de ficar travada em `analisando` para sempre.
    leased_until = models.DateTimeField(null=True, blank=True)
    failure_reason = models.CharField(max_length=200, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Análise de partida"
        verbose_name_plural = "Análises de partidas"
        ordering = ["-created_at"]
        indexes = [
            # O índice que a fila usa: pega pendentes/vencidas em ordem de
            # chegada, sem varrer a tabela.
            models.Index(fields=["status", "leased_until"]),
        ]

    def __str__(self):
        return f"Análise da partida #{self.game_id} ({self.status})"


# Teto diário de análises de partida vs IA, por usuário.
#
# Partida vs IA é reportada pelo APP, com lances que o servidor nunca
# validou: um POST barato compra minutos de engine. É amplificação de
# recurso, mesma família do endpoint aberto que a PR #101 fechou. Dez por dia
# é folgado para quem joga de verdade (o plano Grátis nem chega lá, e o pago
# raramente passa disso) e fecha a porta para o abuso automatizado.
#
# Partida online não precisa de teto: os lances passaram pelo chess.js do
# servidor e o adversário é outra pessoa — não dá para fabricar em volume.
ANALYSIS_DAILY_LIMIT_AI = 10


def analysis_enabled():
    """Feature flag da análise pós-jogo (Fase 2).

    Desligada por padrão de propósito: a análise divide CPU física com as
    partidas ao vivo, e a decisão de ligar deve ser tomada olhando o `queued`
    do pool ao vivo (ver /health do node-api), não no escuro.
    """
    from django.conf import settings

    return bool(getattr(settings, "POST_GAME_ANALYSIS_ENABLED", False))


def enqueue_analysis(game, profiles):
    """Coloca a partida na fila de análise, se ela for elegível.

    `profiles` são os perfis HUMANOS da partida (dois no online, um no vs IA).
    Elegível quando a flag está ligada, a partida tem lances e PELO MENOS UM
    dos jogadores tem plano pago.

    O "pelo menos um" é decisão de produto (2026-08-08): a partida é um
    tabuleiro só, então a análise roda UMA vez. Se o das brancas é pagante e o
    das pretas não, quem paga vê e o outro recebe "indisponível" na leitura —
    analisar duas vezes seria desperdício, e não analisar puniria o pagante
    pelo plano do adversário.

    Gating aqui, no ENFILEIRAMENTO, é o que protege CPU: partida que ninguém
    vai poder ver não entra na fila. O gating de LEITURA é outro, mora na view
    e protege acesso.

    Nunca levanta: a análise é um bônus em cima da partida. Falhar aqui não
    pode derrubar o registro do resultado, que é o que de fato importa.
    """
    from apps.payments.access import has_paid_access

    if not analysis_enabled():
        return None
    if not game.moves:
        return None

    profiles = [p for p in profiles if p is not None]
    if not any(has_paid_access(profile) for profile in profiles):
        return None

    if game.mode == Game.MODE_AI and _ai_analyses_today(profiles[0]) >= (
        ANALYSIS_DAILY_LIMIT_AI
    ):
        return None

    analysis, _created = GameAnalysis.objects.get_or_create(game=game)
    return analysis


def _ai_analyses_today(profile):
    """Quantas análises de partida vs IA este perfil já pediu hoje."""
    return (
        GameAnalysis.objects.filter(
            game__mode=Game.MODE_AI,
            created_at__date=timezone.localdate(),
        )
        .filter(
            models.Q(game__white_player=profile.user)
            | models.Q(game__black_player=profile.user)
        )
        .count()
    )


def llm_feedback_enabled():
    """Feature flag do comentário humanizado (Fase 3).

    Separada da flag da Fase 2 de propósito: a análise Stockfish gasta CPU
    nossa, esta gasta DINHEIRO por chamada. São decisões de ligar diferentes,
    tomadas olhando coisas diferentes, e uma não pode arrastar a outra.

    Chave vazia conta como desligada: sem `OPENROUTER_API_KEY` a chamada
    falharia de todo jeito, e falhar no portão é mais honesto do que gastar
    uma tentativa para descobrir isso.
    """
    from django.conf import settings

    return bool(
        getattr(settings, "LLM_FEEDBACK_ENABLED", False)
        and getattr(settings, "OPENROUTER_API_KEY", "")
    )


class GameLLMFeedback(models.Model):
    """
    Comentário em português sobre a partida, escrito por LLM (Fase 3) em cima
    da análise que o Stockfish já produziu. COMPLEMENTA a Fase 2; não a
    substitui, e não altera nada dela.

    POR QUE TABELA SEPARADA, e não colunas em GameAnalysis:
      1. São ~14 colunas que ficariam nulas na maioria das linhas — o gatilho
         é SOB DEMANDA (botão), então a maior parte das partidas analisadas
         nunca vai ter comentário.
      2. `GameAnalysis` é a FILA de trabalho do node-api, varrida em polling
         com `select_for_update` (InternalAnalysisNextView). Um segundo ciclo
         de vida, com outro lease e outra cadência, na tabela quente da fila
         só produziria contenção de lock por um motivo que não tem nada a ver
         com Stockfish.

    POR QUE PENDURADO EM GameAnalysis, e não em Game: torna a dependência
    ESTRUTURAL. O prompt é montado a partir da análise; sem análise não existe
    linha possível, porque não há a que se ligar. Ancorar em `Game` deixaria a
    validação "só gere se houver análise" por conta da view, que é justamente
    onde ela pode ser esquecida.

    O OneToOne é a garantia de "no máximo 1 por partida" NO BANCO (UNIQUE em
    analysis_id) — dois toques simultâneos não criam duas linhas nem com race.
    A garantia de "no máximo 1 GERAÇÃO BEM-SUCEDIDA" é outra e mora no
    `claim()` abaixo.
    """

    STATUS_GENERATING = "gerando"
    STATUS_DONE = "pronto"
    STATUS_FAILED = "erro"
    STATUS_CHOICES = [
        (STATUS_GENERATING, "Gerando"),
        (STATUS_DONE, "Pronto"),
        (STATUS_FAILED, "Erro"),
    ]

    # Versão do prompt E do formato de saída. Mudou o texto do system prompt,
    # o digest ou as seções esperadas → incrementa, e os comentários antigos
    # continuam identificáveis como "escritos com outro contrato".
    #
    # Incrementar NÃO regenera nada: regeneração retroativa está fora de
    # escopo por decisão (custo). O campo existe para que a decisão de
    # regenerar, se um dia vier, seja possível.
    PROMPT_VERSION = 1

    # Tentativas antes de desistir. Existe para que uma partida que quebra o
    # parser toda vez não vire um cano aberto de custo.
    MAX_ATTEMPTS = 3

    # Prazo do "aluguel" da geração. Menor que o da Fase 2 (que é minutos de
    # engine): aqui é uma chamada HTTP com timeout de dezenas de segundos, e
    # o lease só precisa cobrir o pior caso dela mais folga. Vencido = a
    # thread morreu (deploy, queda) e o trabalho volta a ser reivindicável.
    LEASE_SECONDS = 180

    # Seções que a resposta do modelo precisa ter. É o contrato validado antes
    # de qualquer gravação de `pronto` — ver llm_feedback.parse_sections.
    REQUIRED_SECTIONS = ("resumo", "abertura", "erro_decisivo", "recomendacao")
    MAX_SECTION_CHARS = 600

    analysis = models.OneToOneField(
        GameAnalysis,
        on_delete=models.CASCADE,
        related_name="llm_feedback",
        verbose_name="Análise",
    )
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default=STATUS_GENERATING
    )

    # ── Conteúdo ─────────────────────────────────────────────────────────
    # {"resumo": "...", "abertura": "...", "erro_decisivo": "...",
    #  "recomendacao": "..."} — sempre as 4 chaves quando status=pronto.
    sections = models.JSONField(default=dict, blank=True)
    # A resposta crua do provedor, para quando o parse falhar e for preciso
    # ver o que de fato veio. Sem isto, "schema inválido" é um beco sem saída.
    raw_response = models.TextField(blank=True, default="")

    # ── Contrato / reprodutibilidade ─────────────────────────────────────
    prompt_version = models.IntegerField(default=PROMPT_VERSION)
    model_name = models.CharField(max_length=60, blank=True, default="")

    # ── Custo ────────────────────────────────────────────────────────────
    # Preenchidos DEFENSIVAMENTE: o provedor pode mudar o formato de `usage`,
    # e perder a métrica nunca pode perder um comentário já válido.
    prompt_tokens = models.IntegerField(null=True, blank=True)
    completion_tokens = models.IntegerField(null=True, blank=True)
    cached_tokens = models.IntegerField(null=True, blank=True)
    # Congelado no momento da gravação, a partir do preço vigente. Se o preço
    # mudar, o histórico continua contando o que foi de fato gasto.
    cost_usd = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    latency_ms = models.IntegerField(null=True, blank=True)

    # ── Operação ─────────────────────────────────────────────────────────
    attempts = models.IntegerField(default=0)
    leased_until = models.DateTimeField(null=True, blank=True)
    failure_reason = models.CharField(max_length=200, blank=True, default="")
    # Quem gastou a geração. SET_NULL: apagar a conta não pode apagar o
    # comentário, que pertence à partida e é lido pelo adversário também.
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="llm_feedbacks_requested",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Comentário da partida"
        verbose_name_plural = "Comentários das partidas"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Comentário da análise #{self.analysis_id} ({self.status})"

    @property
    def is_terminal(self):
        """Estado do qual não se sai mais — nem por toque do usuário."""
        return self.status == self.STATUS_DONE or (
            self.status == self.STATUS_FAILED and self.attempts >= self.MAX_ATTEMPTS
        )


def claim_llm_feedback(analysis, user=None, now=None):
    """Reivindica o direito de gerar o comentário desta análise.

    Devolve `(feedback, claimed)`. `claimed=True` significa "é sua vez de
    chamar o provedor"; `False` significa que outra requisição já está
    gerando, que já ficou pronto, ou que as tentativas acabaram.

    TODA a regra de "1 geração por partida" está AQUI, num UPDATE condicional
    — e não espalhada em `if`s de view — porque é uma corrida real: os dois
    jogadores podem tocar o botão no mesmo instante, e o banco é o único lugar
    onde isso se resolve sem lock explícito.

    O que é reivindicável:
      - linha recém-criada (`gerando`, sem lease) — o `created` do get_or_create;
      - `erro` com tentativas sobrando — decisão C: falha do provedor NÃO
        consome a cota do usuário;
      - `gerando` com lease VENCIDO — a thread morreu no meio (deploy, queda).

    O que nunca é reivindicável:
      - `pronto`. Não aparece no filtro, e essa ausência É a regra "sem
        re-geração" (decisão 4). Uma segunda chamada devolve o mesmo texto.
    """
    from django.db.models import F, Q

    now = now or timezone.now()
    lease_until = now + timedelta(seconds=GameLLMFeedback.LEASE_SECONDS)

    feedback, created = GameLLMFeedback.objects.get_or_create(
        analysis=analysis,
        defaults={
            "status": GameLLMFeedback.STATUS_GENERATING,
            "attempts": 1,
            "leased_until": lease_until,
            "requested_by": user,
            "prompt_version": GameLLMFeedback.PROMPT_VERSION,
        },
    )
    if created:
        # A própria criação da linha é a reivindicação: o UNIQUE do OneToOne
        # garante que só uma requisição concorrente chega aqui.
        return feedback, True

    claimed = (
        GameLLMFeedback.objects.filter(pk=feedback.pk)
        .filter(attempts__lt=GameLLMFeedback.MAX_ATTEMPTS)
        .filter(
            Q(status=GameLLMFeedback.STATUS_FAILED)
            | Q(status=GameLLMFeedback.STATUS_GENERATING, leased_until__lt=now)
        )
        .update(
            status=GameLLMFeedback.STATUS_GENERATING,
            leased_until=lease_until,
            attempts=F("attempts") + 1,
            requested_by=user,
            failure_reason="",
        )
    )
    feedback.refresh_from_db()
    return feedback, bool(claimed)


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
        indexes = [
            # As conquistas cumulativas leem o extrato do usuário em ordem de
            # data — "3 vitórias seguidas" pega as últimas N linhas. A FK de
            # `user` já era indexada sozinha pelo Django; o que faltava era a
            # data no MESMO índice, para a ordenação não custar um sort.
            models.Index(fields=["user", "-played_at"]),
        ]

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


# ─────────────────────────────────────────────────────────────────────────────
# CONQUISTAS
#
# Sistema IRMÃO do Modo Campanha, não uma extensão dele. O Campanha
# (CampaignProgress/CampaignWinLog) continua exatamente como está: progressão
# sequencial pelos 5 níveis da IA, com selo por nível. Estas são conquistas de
# outra natureza — marcos de uso do produto, sem ordem entre si.
# ─────────────────────────────────────────────────────────────────────────────


class AchievementDefinition(models.Model):
    """
    O CATÁLOGO de conquistas. Uma linha por conquista disponível.

    POR QUE UMA TABELA, e não constantes em código: o limiar de cada conquista
    (10 partidas, 50 partidas, 20 plies, 7 dias) mora em `params`. Acrescentar
    "100 partidas" amanhã é INSERIR UMA LINHA — sem migration e sem deploy. O
    `WINS_TO_UNLOCK` do Campanha é o contra-exemplo que motivou isto: mudar o
    número de lá exige subir código.

    Regra prática do desenho: acrescentar um TIPO de regra é código (um
    avaliador novo em achievements.py); acrescentar uma CONQUISTA de um tipo
    que já existe é dado.
    """

    # O gatilho PODA a avaliação: um puzzle resolvido não faz o servidor
    # reavaliar as regras de partida, e vice-versa.
    TRIGGER_GAME = "game_finished"
    TRIGGER_PUZZLE = "puzzle_solved"
    TRIGGER_CHOICES = [
        (TRIGGER_GAME, "Fim de partida"),
        (TRIGGER_PUZZLE, "Problema resolvido"),
    ]

    # Os 6 tipos do primeiro corte. Cada um tem um avaliador registrado em
    # `achievements.RULE_EVALUATORS` — um valor aqui sem avaliador lá é
    # ignorado em silêncio (ver o comentário de `check_achievements`).
    RULE_WIN_COUNT = "win_count"
    RULE_RATED_WIN_COUNT = "rated_win_count"
    RULE_GAMES_PLAYED = "games_played"
    RULE_WIN_STREAK = "win_streak"
    RULE_FAST_CHECKMATE = "fast_checkmate"
    RULE_PUZZLE_STREAK = "puzzle_streak"
    RULE_CHOICES = [
        (RULE_WIN_COUNT, "Total de vitórias"),
        (RULE_RATED_WIN_COUNT, "Vitórias valendo rating"),
        (RULE_GAMES_PLAYED, "Partidas jogadas"),
        (RULE_WIN_STREAK, "Vitórias seguidas"),
        (RULE_FAST_CHECKMATE, "Xeque-mate rápido"),
        (RULE_PUZZLE_STREAK, "Dias seguidos resolvendo problema"),
    ]

    # Identidade ESTÁVEL. O app casa ícone e texto por `code`, então ele nunca
    # muda — `name` e `description` podem ser reescritos à vontade sem quebrar
    # cliente nenhum.
    code = models.SlugField(max_length=50, unique=True, verbose_name="Código")
    name = models.CharField(max_length=80, verbose_name="Nome")
    description = models.CharField(max_length=200, verbose_name="Descrição")
    # Nome de ícone do Ionicons, igual ao resto do app.
    icon = models.CharField(max_length=40, blank=True, default="")
    category = models.CharField(max_length=20, blank=True, default="")

    trigger = models.CharField(max_length=20, choices=TRIGGER_CHOICES)
    rule_type = models.CharField(max_length=30, choices=RULE_CHOICES)
    # O limiar: {"threshold": 10} · {"max_plies": 20}. JSON e não coluna
    # tipada porque cada regra tem parâmetros diferentes, e uma coluna por
    # parâmetro viraria uma tabela cheia de nulos.
    params = models.JSONField(default=dict, blank=True)

    order = models.IntegerField(default=0, verbose_name="Ordem de exibição")
    # Aposenta sem apagar: apagar a definição apagaria a conquista de quem já
    # a ganhou (ver o PROTECT em UserAchievement).
    is_active = models.BooleanField(default=True, verbose_name="Ativa")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "Conquista"
        verbose_name_plural = "Conquistas"

    def __str__(self):
        return f"{self.code} — {self.name}"


class UserAchievement(models.Model):
    """
    Uma conquista JÁ DESBLOQUEADA por um usuário.

    O `unique_together` é a regra de "uma vez só" — no BANCO, não em `if` de
    view. É também por isso que este sistema NÃO precisa de um log de evento
    como o `CampaignWinLog`: aquele existe porque `CampaignProgress.wins` é um
    CONTADOR, e reprocessar a mesma partida o incrementaria duas vezes.
    Conquista é BOOLEANA — reavaliar o mesmo evento cai num `get_or_create`
    que é no-op, e a constraint garante isso sem ajuda de ninguém.
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="achievements"
    )
    # PROTECT: apagar uma definição que alguém já conquistou apagaria a
    # conquista dessa pessoa. Para tirar de circulação, use `is_active=False`.
    achievement = models.ForeignKey(
        AchievementDefinition, on_delete=models.PROTECT, related_name="unlocks"
    )
    unlocked_at = models.DateTimeField(auto_now_add=True)
    # Null = ainda não comemorada. É a FONTE DA VERDADE de "já festejei", e o
    # que impede o fim de partida e a tela de conquistas celebrarem a mesma
    # coisa duas vezes. Mora no servidor (e não no app) para a comemoração não
    # se repetir ao trocar de aparelho.
    seen_at = models.DateTimeField(null=True, blank=True)
    # Rastro INFORMATIVO da partida que originou a conquista — serve para
    # contar ao usuário onde ela aconteceu e para diagnóstico. Explicitamente
    # NÃO é mecanismo de idempotência (quem faz isso é o unique_together), e
    # por isso pode ser null sem que nada quebre: as conquistas de puzzle não
    # têm partida de origem.
    source_history = models.ForeignKey(
        "GameHistory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="achievements_unlocked",
    )

    class Meta:
        unique_together = ("user", "achievement")
        ordering = ["-unlocked_at"]
        verbose_name = "Conquista do usuário"
        verbose_name_plural = "Conquistas dos usuários"

    def __str__(self):
        return f"{self.user.email} — {self.achievement.code}"
