' Pulso Studio: arranca el editor sin ventana y espera a que termine (asi la tarea de Windows sabe que sigue vivo).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & dir & "\editor-segundo-plano.cmd""", 0, True
