# API Documentation - Auth Module

## Vue d'ensemble

Le module `auth` gère l'authentification et l'autorisation dans le système TattooStudio. Il utilise JWT (JSON Web Tokens) pour l'authentification stateless et fournit un système complet de gestion des utilisateurs avec inscription, connexion, vérification d'email, et gestion des mots de passe.

## Architecture du Module

### Fichiers principaux

- **Controller**: `auth.controller.ts` - 7 routes
- **Service**: `auth.service.ts` - 6 méthodes principales
- **Strategy**: `jwt.strategy.ts` - Stratégie JWT Passport
- **Guard**: `jwt-auth.guard.ts` - Protection des routes
- **DTOs**: Validation des données d'entrée

### Base URL

```
/auth
```

## Authentication Strategy

### JWT Configuration

```typescript
// jwt.strategy.ts
export type UserPayload = {
  userId: string,
};

export interface RequestWithUser extends Request {
  user: UserPayload;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate({ userId }: UserPayload) {
    return { userId };
  }
}
```

### JWT Guard

```typescript
// jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

**Utilisation** :
```typescript
@UseGuards(JwtAuthGuard)
@Get('protected-route')
async protectedMethod(@Request() req: RequestWithUser) {
  const userId = req.user.userId; // Automatiquement injecté
}
```

## Routes API

### 1. Connexion utilisateur

```http
POST /auth/login
```

**Authentification**: Non requise
**Validation**: `LoginUserDto`

**Body**:
```json
{
  "email": "user@example.com",
  "password": "motdepasse123"
}
```

**Validation des données**:
- `email`: Email valide requis
- `password`: Mot de passe requis (non vide)

**Logique métier**:
```typescript
async login({ authBody }: { authBody: LoginUserDto }) {
  const { email, password } = authBody;

  // 1. Vérifier l'existence de l'utilisateur
  const existingUser = await this.prisma.user.findUnique({
    where: { email }
  });

  if (!existingUser) {
    return { error: true, message: 'Utilisateur non trouvé' };
  }

  // 2. Vérifier le mot de passe
  const isPasswordValid = await this.isPasswordValid({
    password, 
    hashedPassword: existingUser.password
  });

  if (!isPasswordValid) {
    return { error: true, message: 'Mot de passe incorrect' };
  }

  // 3. Vérifier la validation de l'email
  if (!existingUser.emailVerified) {
    return { error: true, message: 'Email non vérifié' };
  }

  // 4. Générer le token JWT
  return this.authenticateUser({ userId: existingUser.id });
}
```

**Réponse succès**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "id": "uuid-user",
  "role": "user_salon",
  "email": "user@example.com",
  "salonName": "Ink Studio",
  "saasPlan": "BUSINESS",
  "agendaMode": "PAR_TATOUEUR",
  "phone": "0600000000",
  "address": "12 rue Exemple",
  "verifiedSalon": true,
  "salonHours": "{...}"
}
```

**Note agendaMode**:

- `agendaMode` est renvoyé dès la connexion pour permettre au front de savoir immédiatement si le salon est en mode `GLOBAL` ou `PAR_TATOUEUR`.
- La valeur provient de `saasPlanDetails.agendaMode` (fallback `null` si indisponible).

**Réponses erreur** :
```json
{
  "error": true,
  "message": "Utilisateur non trouvé"
}
```

### 2. Inscription utilisateur

```http
POST /auth/register
```

**Authentification**: Non requise
**Validation**: `CreateUserDto`

**Body**:
```json
{
  "email": "nouveau@example.com",
  "salonName": "Ink Studio",
  "saasPlan": "BASIC",
  "password": "motdepasse123"
}
```

**Validation des données**:
- `email`: Email valide requis
- `salonName`: Nom du salon requis (string non vide)
- `saasPlan`: Plan SaaS valide (enum: BASIC, MEDIUM, PREMIUM)
- `password`: Minimum 6 caractères

**Logique métier complexe**:
```typescript
async register({ registerBody }: { registerBody: CreateUserDto }) {
  const { email, salonName, saasPlan, password } = registerBody;

  // 1. Vérifier l'unicité de l'email
  const existingUser = await this.prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    return { error: true, message: 'Email déjà utilisé' };
  }

  // 2. Hashage du mot de passe avec bcrypt
  const hashedPassword = await this.hashPassword({ password });

  // 3. Création de l'utilisateur
  const createdUser = await this.prisma.user.create({
    data: {
      email,
      salonName,
      saasPlan,
      password: hashedPassword,
    },
  });

  // 4. Création du plan SaaS détaillé
  await this.saasService.createUserPlanOnRegistration(createdUser.id, saasPlan);

  // 5. Génération du token de vérification email
  const token = Math.floor(100000 + Math.random() * 900000).toString(); // 6 chiffres
  const expires = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes

  await this.prisma.verificationToken.create({
    data: { email, token, expires }
  });

  // 6. Envoi de l'email de confirmation
  const confirmationUrl = `${process.env.FRONTEND_URL}/verifier-email?token=${token}&email=${email}`;
  
  // Email envoyé par le service mail (détails dans la documentation)
}
```

**Réponse succès**:
```json
{
  "message": "Utilisateur créé avec succès. Vérifiez votre email.",
  "userId": "uuid-user"
}
```

### 3. Obtenir l'utilisateur authentifié

```http
GET /auth
```

**Authentification**: JWT obligatoire
**Guard**: `JwtAuthGuard`

**Headers requis**:
```json
{
  "Authorization": "Bearer <token>"
}
```

**Logique métier**:
```typescript
@UseGuards(JwtAuthGuard)
@Get()
async getAuthenticatedUser(@Request() request: RequestWithUser) {
  // Le userId est automatiquement extrait du token JWT
  return await this.userService.getUserById({ userId: request.user.userId });
}
```

**Réponse**:
```json
{
  "id": "uuid-user",
  "email": "user@example.com",
  "salonName": "Ink Studio",
  "saasPlan": "BASIC",
  "emailVerified": "2024-01-15T10:00:00.000Z",
  "createdAt": "2024-01-10T10:00:00.000Z"
}
```

### 4. Vérification d'email

```http
GET /auth/verify-email?token=123456&email=user@example.com
```

**Authentification**: Non requise

**Query parameters**:
- `token`: Token de vérification (6 chiffres)
- `email`: Email à vérifier

**Logique métier**:
```typescript
async verifyEmail(@Query('token') token: string, @Query('email') email: string) {
  // 1. Rechercher le token de vérification
  const record = await this.prisma.verificationToken.findUnique({
    where: { email_token: { email, token } }
  });

  // 2. Vérifier validité et expiration
  if (!record || record.expires < new Date()) {
    throw new BadRequestException("Lien invalide ou expiré.");
  }

  // 3. Marquer l'email comme vérifié
  await this.prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() }
  });

  // 4. Supprimer le token utilisé
  await this.prisma.verificationToken.delete({
    where: { id: record.id }
  });

  return { message: "Email vérifié avec succès." };
}
```

**Réponse succès**:
```json
{
  "message": "Email vérifié avec succès."
}
```

### 5. Mot de passe oublié

```http
POST /auth/forgot-password
```

**Authentification**: Non requise

**Body**:
```json
{
  "email": "user@example.com"
}
```

**Logique métier**:
```typescript
async sendResetPasswordEmail(email: string) {
  // 1. Vérifier l'existence de l'utilisateur
  const user = await this.prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Retourner un message générique pour la sécurité
    return { message: "Si un compte existe avec cette adresse, un email a été envoyé." };
  }

  // 2. Générer un token de réinitialisation sécurisé
  const token = randomBytes(32).toString('hex'); // 64 caractères hex
  const expires = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes

  // 3. Sauvegarder le token
  await this.prisma.passwordResetToken.create({
    data: { email, token, expires }
  });

  // 4. Envoyer l'email de réinitialisation
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${email}`;

  await this.mailService.sendMail({
    to: email,
    subject: "Réinitialisation de votre mot de passe",
    html: `
      <h2>Réinitialisation du mot de passe</h2>
      <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
      <p>Si ce n'est pas vous, ignorez cet email.</p>
      <a href="${resetUrl}">Cliquez ici pour réinitialiser</a>
      <p>Ce lien est valable 15 minutes.</p>
    `
  });
}
```

**Réponse**:
```json
{
  "message": "Si un compte existe avec cette adresse, un email a été envoyé."
}
```

### 6. Réinitialisation du mot de passe

```http
POST /auth/reset-password
```

**Authentification**: Non requise

**Body**:
```json
{
  "email": "user@example.com",
  "token": "abc123def456...",
  "password": "nouveaumotdepasse"
}
```

**Logique métier**:
```typescript
async resetPassword({ email, token, password }: {
  email: string;
  token: string;
  password: string;
}) {
  // 1. Vérifier le token de réinitialisation
  const record = await this.prisma.passwordResetToken.findUnique({
    where: { email_token: { email, token } }
  });

  if (!record || record.expires < new Date()) {
    return { error: true, message: "Token invalide ou expiré" };
  }

  // 2. Hasher le nouveau mot de passe
  const hashedPassword = await this.hashPassword({ password });

  // 3. Mettre à jour le mot de passe
  await this.prisma.user.update({
    where: { email },
    data: { password: hashedPassword }
  });

  // 4. Supprimer le token utilisé
  await this.prisma.passwordResetToken.delete({
    where: { id: record.id }
  });

  return { message: "Mot de passe mis à jour avec succès." };
}
```

### 7. Changement de mot de passe

```http
POST /auth/change-password
```

**Authentification**: JWT obligatoire
**Guard**: `JwtAuthGuard`
**Validation**: `ChangePasswordDto`

**Headers requis**:
```json
{
  "Authorization": "Bearer <token>"
}
```

**Body**:
```json
{
  "currentPassword": "ancienmdp",
  "newPassword": "nouveaumdp123",
  "confirmPassword": "nouveaumdp123"
}
```

**Validation des données**:
- `currentPassword`: Requis, string non vide
- `newPassword`: Minimum 8 caractères, string non vide
- `confirmPassword`: Doit correspondre au nouveau mot de passe

**Logique métier**:
```typescript
async changePassword({
  @Request() request: RequestWithUser,
  @Body() changePasswordDto: ChangePasswordDto
}) {
  const userId = request.user.userId;
  const { currentPassword, newPassword, confirmPassword } = changePasswordDto;

  // 1. Validation côté controller
  if (newPassword !== confirmPassword) {
    throw new BadRequestException('Les mots de passe de confirmation ne correspondent pas.');
  }

  // 2. Logique service
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  
  // 3. Vérifier l'ancien mot de passe
  const isCurrentPasswordValid = await this.isPasswordValid({
    password: currentPassword,
    hashedPassword: user.password
  });

  if (!isCurrentPasswordValid) {
    return { error: true, message: 'Mot de passe actuel incorrect' };
  }

  // 4. Hasher et sauvegarder le nouveau
  const hashedNewPassword = await this.hashPassword({ password: newPassword });
  
  await this.prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword }
  });
}
```

## Méthodes utilitaires du service

### Hashage des mots de passe

```typescript
private async hashPassword({ password }: { password: string }) {
  const hashPassword = await hash(password, 10); // bcrypt avec salt rounds = 10
  return hashPassword;
}
```

### Validation des mots de passe

```typescript
private async isPasswordValid({ password, hashedPassword }: {
  password: string, 
  hashedPassword: string
}) {
  const isPasswordValid = await compare(password, hashedPassword);
  return isPasswordValid;
}
```

### Génération de tokens JWT

```typescript
private authenticateUser({ userId }: UserPayload) {
  const payload: UserPayload = { userId }
  
  const access_token = this.jwtService.sign(payload);
  console.log("🔑 Token généré avec userId :", userId);
  console.log("📦 Payload utilisé :", payload);
  console.log('🔑 Token généré :', access_token);
  
  return {
    access_token,
    userId
  }
}
```

## Modèles de données Prisma

### User

```prisma
model User {
  id            String      @id @default(cuid())
  email         String      @unique
  salonName     String
  saasPlan      SaasPlan
  password      String
  emailVerified DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  // Relations...
}
```

### VerificationToken

```prisma
model VerificationToken {
  id      String   @id @default(cuid())
  email   String
  token   String
  expires DateTime
  
  @@unique([email, token])
}
```

### PasswordResetToken

```prisma
model PasswordResetToken {
  id      String   @id @default(cuid())
  email   String
  token   String
  expires DateTime
  
  @@unique([email, token])
}
```

### SaasPlan (Enum)

```prisma
enum SaasPlan {
  BASIC
  MEDIUM
  PREMIUM
}
```

## Sécurité

### Bonnes pratiques implémentées

1. **Hashage des mots de passe** : bcrypt avec 10 salt rounds
2. **Tokens JWT signés** : Secret environment variable
3. **Expiration des tokens** : Vérification automatique
4. **Tokens de vérification limités dans le temps** :
   - Email : 10 minutes
   - Reset password : 15 minutes
5. **Messages d'erreur génériques** : Éviter la divulgation d'informations
6. **Validation stricte des données** : DTOs avec class-validator
7. **Tokens sécurisés** : randomBytes(32) pour la réinitialisation

### Configuration JWT

```typescript
// Variables d'environnement requises
JWT_SECRET=your-super-secret-key
FRONTEND_URL=http://localhost:3000
```

### Headers d'authentification

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Intégration avec d'autres modules

### Avec le module User

- Récupération des informations utilisateur
- Mise à jour des données de profil

### Avec le module SaaS

- Création automatique du plan lors de l'inscription
- Vérification des limitations selon le plan

### Avec le service Mail

- Envoi d'emails de confirmation
- Envoi d'emails de réinitialisation de mot de passe

### Avec tous les modules protégés

- Authentification via `JwtAuthGuard`
- Extraction automatique du `userId` depuis le token

## Flux d'authentification complet

### 1. Inscription

```
POST /auth/register
├── Validation des données
├── Vérification unicité email
├── Hashage du mot de passe
├── Création utilisateur + plan SaaS
├── Génération token vérification email
└── Envoi email confirmation

GET /auth/verify-email?token=123456&email=user@example.com
├── Validation du token
├── Vérification expiration
├── Activation du compte
└── Suppression du token
```

### 2. Connexion

```
POST /auth/login
├── Validation des données
├── Vérification existence utilisateur
├── Validation du mot de passe
├── Vérification email confirmé
└── Génération token JWT

GET /auth (avec token)
├── Validation JWT automatique
├── Extraction userId du token
└── Retour des données utilisateur
```

### 3. Réinitialisation mot de passe

```
POST /auth/forgot-password
├── Vérification existence utilisateur
├── Génération token sécurisé
├── Sauvegarde token avec expiration
└── Envoi email avec lien

POST /auth/reset-password
├── Validation du token
├── Vérification expiration
├── Hashage nouveau mot de passe
├── Mise à jour utilisateur
└── Suppression du token
```

## Gestion des erreurs

### Erreurs d'authentification

- **401 Unauthorized** : Token manquant ou invalide
- **403 Forbidden** : Token expiré
- **400 Bad Request** : Données invalides

### Erreurs métier

- Email déjà utilisé
- Mot de passe incorrect
- Email non vérifié
- Token de vérification expiré
- Mot de passe actuel incorrect

### Réponses d'erreur standardisées

```json
{
  "error": true,
  "message": "Description de l'erreur"
}
```

## Notes de déploiement

### Variables d'environnement requises

```env
JWT_SECRET=your-super-secret-key-minimum-32-characters
FRONTEND_URL=https://yourdomain.com
DATABASE_URL=postgresql://...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Considérations de sécurité

1. **JWT_SECRET** : Doit être complexe et unique par environnement
2. **HTTPS obligatoire** en production pour protéger les tokens
3. **Rate limiting** recommandé sur les routes d'authentification
4. **Logs de sécurité** pour surveiller les tentatives de connexion
5. **Refresh tokens** non implémentés (à considérer pour l'amélioration)
