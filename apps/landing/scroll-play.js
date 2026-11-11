// Lance la vidéo quand elle est à moitié visible et la met en pause quand elle sort de l'écran.
// Aucune donnée collectée, aucun appel réseau : seulement play() et pause() sur la vidéo de la page.
// Les navigateurs n'autorisent la lecture automatique que sans le son : la vidéo est donc muette au départ
// (le visiteur active le son avec les commandes). Rien ne démarre pour qui a demandé moins d'animations.
(function () {
  var video = document.querySelector('.player video');
  if (!video || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Si le visiteur met la vidéo en pause lui-même, on ne la relance plus de force.
  var pausedByVisitor = false;
  var autoPause = false;
  // L'événement « pause » arrive après l'appel à pause() : c'est lui qui retire le drapeau.
  video.addEventListener('pause', function () {
    if (autoPause) autoPause = false;
    else if (!video.ended) pausedByVisitor = true;
  });

  new IntersectionObserver(
    function (entries) {
      var entry = entries[0];
      // « Visible » : la moitié de la vidéo est à l'écran, ou elle occupe la moitié de la hauteur de l'écran
      // (sur une fenêtre plus basse que la vidéo, la première condition ne serait jamais vraie).
      var screen = entry.rootBounds ? entry.rootBounds.height : window.innerHeight;
      var visible =
        entry.isIntersecting &&
        (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= screen * 0.5);
      if (visible && video.paused && !pausedByVisitor) {
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
      } else if (!visible && !video.paused) {
        autoPause = true;
        video.pause();
      }
    },
    { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  ).observe(video);
})();
