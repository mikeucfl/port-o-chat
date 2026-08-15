// Scratch verification tool, NOT part of the port-o-chat Java application.
// Exercises the real com.lttldrgn.portochat.client.ServerConnection (the
// same class the Swing client uses) headlessly against a server, to check
// wire compatibility with the Electron port without needing a GUI.
//
// Compile/run against the built Java project's classes + protobuf-java jar.
import com.lttldrgn.portochat.client.ServerConnection;
import com.lttldrgn.portochat.client.ServerDataListener;
import com.lttldrgn.portochat.common.User;
import java.util.List;

public class JavaInteropTester {
    public static void main(String[] args) throws Exception {
        String host = args.length > 0 ? args[0] : "127.0.0.1";
        int port = args.length > 1 ? Integer.parseInt(args[1]) : 3457;

        ServerConnection connection = new ServerConnection();
        connection.addDataListener(new ServerDataListener() {
            public void userListReceived(List<User> users, String channel) {
                System.out.println("[recv] userListReceived channel=" + channel + " users=" + users);
            }
            public void receiveChatMessage(User fromUser, boolean action, String message, String channel) {
                System.out.println("[recv] chatMessage from=" + fromUser + " action=" + action
                        + " channel=" + channel + " message=" + message);
            }
            public void channelListReceived(List<String> channels) {
                System.out.println("[recv] channelListReceived " + channels);
            }
            public void receiveChannelJoinPart(String userId, String channel, boolean join) {
                System.out.println("[recv] channelJoinPart userId=" + userId + " channel=" + channel + " join=" + join);
            }
            public void channelStatusReceived(String channel, boolean created) {
                System.out.println("[recv] channelStatusReceived channel=" + channel + " created=" + created);
            }
            public void handleServerConnection(String username, boolean success) {
                System.out.println("[recv] handleServerConnection username=" + username + " success=" + success);
            }
            public void userDoesNotExist(String username) {
                System.out.println("[recv] userDoesNotExist " + username);
            }
        });

        System.out.println("Connecting to " + host + ":" + port + " as \"java-tester\"...");
        connection.setUsername("java-tester");
        connection.connectToServer(host, port);

        Thread.sleep(500);
        System.out.println("Joining #interop-test...");
        connection.joinChannel("#interop-test");

        Thread.sleep(500);
        System.out.println("Sending a channel message...");
        connection.sendMessage("#interop-test", true, false, "hello from the real Java client");

        Thread.sleep(500);
        System.out.println("Requesting channel list...");
        connection.requestListOfChannels();

        Thread.sleep(1500);
        System.out.println("Done. Disconnecting.");
        connection.disconnect();
        System.exit(0);
    }
}
