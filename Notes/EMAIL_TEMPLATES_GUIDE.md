# Guide d'utilisation des Templates d'Emails InkStudio

## Vue d'ensemble

Le système de templates d'emails d'InkStudio offre un design cohérent et professionnel pour toutes les communications automatisées. Les templates utilisent la charte graphique du site web avec les couleurs, polices et styles définis.

## Couleurs utilisées

```css
/* Couleurs principales */
--color-primary-400: #c79f8b;     /* Beige rosé clair */
--color-primary-500: #af7e70;     /* Beige rosé */

--color-secondary-500: #3e2c27;   /* Marron foncé */
--color-secondary-600: #2d1f1a;   /* Marron très foncé */

--color-tertiary-400: #ff9d00;    /* Orange clair */
--color-tertiary-500: #ff5500;    /* Orange vif */

--color-noir-500: #1a1a1a;        /* Noir principal */
--color-noir-700: #131313;        /* Noir profond */
```

## Polices utilisées

- **Montserrat Alternates** : Titres et éléments importants
- **Exo 2** : Texte principal et corps des emails
- **Didact Gothic** : Taglines et éléments secondaires

## Services disponibles

### EmailTemplateService

Service principal pour générer les templates HTML.

### MailService (étendu)

Service pour envoyer les emails avec les templates intégrés.

## Types d'emails disponibles

### 1. Confirmation de rendez-vous (Client)

```typescript
await this.mailService.sendAppointmentConfirmation(clientEmail, {
  recipientName: 'Jean Dupont',
  appointmentDetails: {
    date: 'Lundi 15 janvier 2024',
    time: '14:00 - 16:00',
    duration: '2 heures',
    service: 'Tatouage avant-bras',
    tatoueur: 'Marie Martin',
    price: 250
  }
});
```

**Caractéristiques** :
- Design chaleureux avec dégradés orange
- Carte de détails avec fond sombre
- Bouton d'action principal
- Message d'accueil personnalisé
- Instructions importantes en surbrillance

### 2. Notification nouveau rendez-vous (Salon)

```typescript
await this.mailService.sendNewAppointmentNotification(salonEmail, {
  recipientName: 'Jean Dupont',
  salonName: 'InkStudio Paris',
  appointmentDetails: {
    date: 'Lundi 15 janvier 2024',
    time: '14:00 - 16:00',
    service: 'Tatouage avant-bras',
    tatoueur: 'Marie Martin',
    price: 250
  }
});
```

**Caractéristiques** :
- Résumé professionnel du rendez-vous
- Bouton vers le dashboard
- Design sobre pour usage professionnel

### 3. Vérification d'email

```typescript
await this.mailService.sendEmailVerification(email, {
  recipientName: 'InkStudio Paris',
  verificationToken: '123456'
});
```

**Caractéristiques** :
- Token affiché dans un bloc stylisé
- Message de bienvenue
- Informations d'expiration

### 4. Réinitialisation de mot de passe

```typescript
await this.mailService.sendPasswordReset(email, {
  recipientName: email,
  resetToken: 'abc123def456...'
});
```

**Caractéristiques** :
- Bouton CTA sécurisé
- Messages de sécurité
- Design professionnel

### 5. Suivi post-tatouage

```typescript
await this.mailService.sendFollowUp(clientEmail, {
  recipientName: 'Jean Dupont',
  followUpDetails: {
    appointmentDate: '15 janvier 2024',
    daysSince: 7,
    instructions: 'Continuez à appliquer la crème cicatrisante...'
  }
});
```

**Caractéristiques** :
- Conseils de soin personnalisés
- Suivi temporel du tatouage
- Bouton de contact

### 6. Modification de rendez-vous

```typescript
await this.mailService.sendAppointmentModification(clientEmail, {
  recipientName: 'Jean Dupont',
  appointmentDetails: {
    date: 'Mardi 16 janvier 2024',
    time: '15:00 - 17:00',
    service: 'Tatouage avant-bras',
    tatoueur: 'Marie Martin'
  }
});
```

### 7. Annulation de rendez-vous

```typescript
await this.mailService.sendAppointmentCancellation(clientEmail, {
  recipientName: 'Jean Dupont',
  appointmentDetails: {
    date: 'Lundi 15 janvier 2024',
    time: '14:00 - 16:00',
    service: 'Tatouage avant-bras'
  }
});
```

### 8. Email personnalisé

```typescript
await this.mailService.sendCustomEmail(email, 'Sujet personnalisé', {
  recipientName: 'Jean Dupont',
  customMessage: `
    <p>Votre message personnalisé ici...</p>
    <p>Avec du HTML si nécessaire.</p>
  `
});
```

## Structure des templates

### Template de base

Tous les emails utilisent la même structure de base :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <!-- Meta tags et styles -->
</head>
<body>
  <div class="email-container">
    <!-- Header avec logo InkStudio -->
    <div class="header">
      <div class="logo">InkStudio</div>
      <div class="tagline">Votre salon de tatouage</div>
    </div>
    
    <!-- Contenu spécifique -->
    <div class="content">
      <!-- Message personnalisé -->
    </div>
    
    <!-- Footer avec liens -->
    <div class="footer">
      <!-- Informations de contact -->
    </div>
  </div>
</body>
</html>
```

### Éléments de design

#### 1. Header avec dégradé

```css
background: linear-gradient(90deg, #ff5500, #ff9d00);
```

#### 2. Cartes de détails

```css
background: linear-gradient(135deg, #3e2c27, #2d1f1a);
border-left: 5px solid #af7e70;
```

#### 3. Boutons CTA

```css
background: linear-gradient(90deg, #af7e70, #c79f8b);
border-radius: 25px;
```

#### 4. Boîtes d'avertissement

```css
background: linear-gradient(135deg, #ff5500, #ff9d00);
```

## Responsive Design

Les templates sont entièrement responsives :

```css
@media (max-width: 600px) {
  .email-container {
    margin: 10px;
  }
  
  .header, .content, .footer {
    padding: 20px;
  }
  
  .cta-button {
    width: 100%;
  }
}
```

## Exemples d'intégration

### Dans le service Appointments

```typescript
// Ancien code (à remplacer)
await this.mailService.sendMail({
  to: client.email,
  subject: "Confirmation de rendez-vous",
  html: `<h1>Bonjour ${client.name}</h1>...`
});

// Nouveau code avec template
await this.mailService.sendAppointmentConfirmation(client.email, {
  recipientName: `${client.firstName} ${client.lastName}`,
  appointmentDetails: {
    date: appointment.start.toLocaleDateString('fr-FR'),
    time: appointment.start.toLocaleTimeString('fr-FR'),
    service: appointment.prestation,
    tatoueur: appointment.tatoueur?.name
  }
});
```

### Dans le service Auth

```typescript
// Ancien code (à remplacer)
await this.mailService.sendMail({
  to: email,
  subject: "Vérification d'email",
  html: `<p>Votre code : ${token}</p>`
});

// Nouveau code avec template
await this.mailService.sendEmailVerification(email, {
  recipientName: user.salonName,
  verificationToken: token
});
```

## Configuration requise

### Variables d'environnement

```env
FRONTEND_URL=https://votre-domaine.com
EMAIL_SERVICE=gmail
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=true
EMAIL_USER=votre-email@gmail.com
EMAIL_PASSWORD=votre-mot-de-passe-app
```

### Dépendances

```json
{
  "@nestjs/common": "^10.0.0",
  "nodemailer": "^6.9.0"
}
```

## Bonnes pratiques

### 1. Données de template

Toujours vérifier les données avant de les passer :

```typescript
const templateData: EmailTemplateData = {
  recipientName: client.firstName && client.lastName 
    ? `${client.firstName} ${client.lastName}` 
    : 'Cher client',
  appointmentDetails: {
    date: appointment.start.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    time: appointment.start.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
};
```

### 2. Gestion des erreurs

```typescript
try {
  await this.mailService.sendAppointmentConfirmation(email, data);
} catch (error) {
  console.error('Erreur envoi email:', error);
  // Ne pas faire échouer l'opération principale
}
```

### 3. Tests d'emails

```typescript
// En développement, loguer le HTML généré
const html = this.emailTemplateService.generateAppointmentConfirmationEmail(data);
console.log('Email HTML:', html);
```

## Personnalisation

### Ajouter un nouveau type d'email

1. Créer la méthode dans `EmailTemplateService` :

```typescript
generateNewEmailType(data: EmailTemplateData): string {
  const content = `
    <div class="content">
      <!-- Votre contenu HTML -->
    </div>
  `;
  return this.getBaseTemplate(content, 'Titre de l\'email');
}
```

2. Ajouter la méthode dans `MailService` :

```typescript
async sendNewEmailType(to: string, data: EmailTemplateData) {
  const html = this.emailTemplateService.generateNewEmailType(data);
  await this.sendMail({
    to,
    subject: 'Sujet de l\'email',
    html,
  });
}
```

### Modifier les couleurs

Modifier les variables CSS dans `getBaseTemplate()` :

```css
.email-container {
  background: linear-gradient(135deg, #votre-couleur-1, #votre-couleur-2);
}
```

## Maintenance

### Tester les templates

1. Créer un endpoint de test :

```typescript
@Get('test-email')
async testEmail() {
  await this.mailService.sendAppointmentConfirmation('test@example.com', {
    recipientName: 'Test User',
    appointmentDetails: {
      date: 'Lundi 15 janvier 2024',
      time: '14:00 - 16:00',
      service: 'Test service'
    }
  });
  return { message: 'Email de test envoyé' };
}
```

2. Utiliser des services comme Mailtrap pour les tests

### Monitoring

Ajouter des logs pour surveiller les envois :

```typescript
console.log(`📧 Email envoyé: ${subject} → ${to}`);
```

## Support des clients email

Les templates sont testés et compatibles avec :
- ✅ Gmail (web, mobile, app)
- ✅ Outlook (web, desktop, mobile)
- ✅ Apple Mail (iOS, macOS)
- ✅ Yahoo Mail
- ✅ Thunderbird
- ✅ Clients mobiles (iOS, Android)

## Sécurité

- Échappement automatique des données utilisateur
- Validation des emails avant envoi
- Protection contre les injections HTML
- HTTPS obligatoire pour les liens

Les templates InkStudio offrent une expérience email professionnelle et cohérente avec l'identité visuelle de votre salon de tatouage !
